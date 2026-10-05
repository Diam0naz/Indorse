use anchor_lang::prelude::*;
#[allow(deprecated)] // anchor 0.32 re-exports these from solana-instructions-sysvar
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht");

/// Bootstrap authority — the only key that may create the `Config` PDA, and
/// nothing else. Every runtime gate (oracle reading, settlement, treasury
/// withdrawal, verifier-set governance) reads `config` instead of this const,
/// so moving the protocol to a multisig is a `set_roles` transaction — never
/// a redeploy.
pub const ADMIN: Pubkey = anchor_lang::pubkey!("AXUTwBhtwbgAJGAZYKHXAJgSo4dMC29XrnbP91BPcYg8");

/// Maximum members in the verifier set — bounds the fixed-size accounts so
/// `post_bond` never needs a realloc.
pub const MAX_VERIFIERS: usize = 7;

/// Maximum readers in the oracle set — bounds the fixed-size tally so a
/// season's readings never need a realloc.
pub const MAX_ORACLES: usize = 7;

/// Reward paid from the reward vault for one quorum-approved report.
/// Protocol-fixed: `reward_report` is permissionless, so neither the amount
/// nor the destination may be caller-chosen. Changing the schedule is a
/// program upgrade, not a parameter.
pub const REPORT_REWARD: u64 = 1_000_000;

/// Switchboard On-Demand job values are fixed-point with 18 decimals: the
/// probe's 22.2 mm rainfall arrived as 22_200_000_000_000_000_000. Our
/// tally unit is mm × 10, so one tally unit is 1e17 on the job scale — a
/// receipt that doesn't divide evenly is refused, never rounded into a
/// rainfall nobody reported.
pub const SWITCHBOARD_UNIT_SCALE: u128 = 100_000_000_000_000_000; // 1e17

/// The signed receipt message: slothash(32) ‖ feed_hash(32) ‖ value
/// i128 LE(16) ‖ min_oracle_samples(1).
pub const SWITCHBOARD_MESSAGE_LEN: usize = 81;

/// Distinct pinned enclave signatures a receipt must carry, regardless of
/// what the job itself declares.
pub const SWITCHBOARD_MIN_SIGNERS: usize = 3;

/// Solana's native ed25519 batch-verify program. A receipt's signatures are
/// only true because this precompile ran successfully earlier in the same
/// transaction — our instruction re-reads what it proved.
pub const ED25519_VERIFY_PROGRAM: Pubkey =
    anchor_lang::pubkey!("Ed25519SigVerify111111111111111111111111111");

/// The instructions sysvar, pinned by `address` on the account that feeds
/// `load_instruction_at_checked`: if it were anything else, a caller could
/// hand us an instruction list the runtime never verified.
pub const INSTRUCTIONS_SYSVAR: Pubkey =
    anchor_lang::pubkey!("Sysvar1nstructions1111111111111111111111111");

/// The SlotHashes sysvar, pinned by `address` because solana-sysvar 2.3+
/// refuses in-program deserialization of `SlotHashes` outright
/// (`from_account_info` → `UnsupportedSysvar`: the 20 KB account is "too
/// large to bincode::deserialize"), and anchor reports that refusal as a
/// misleading `AccountSysvarMismatch`. The freshness check therefore reads
/// the raw bytes itself — this pin just guarantees they are the sysvar's.
pub const SLOT_HASHES_SYSVAR: Pubkey =
    anchor_lang::pubkey!("SysvarS1otHashes111111111111111111111111111");

// ─────────────────────────────────────────────────────────────────────────────
//  Program
// ─────────────────────────────────────────────────────────────────────────────

#[program]
pub mod indorse_program {
    use super::*;

    // =========================================================================
    //  LAYER 0 — CONFIG (authority as data, not as a const)
    // =========================================================================

    /// Bootstrap the config PDA once. `init` refuses a second call and the
    /// signer must be the hard-coded `ADMIN`; from here on the authority is
    /// account data that `set_roles` can rotate.
    pub fn init_config(
        ctx: Context<InitConfig>,
        admin: Pubkey,
        verifier: Pubkey,
        oracle: Pubkey,
    ) -> Result<()> {
        require!(admin != Pubkey::default(), FarmError::UnauthorisedAdmin);

        let config = &mut ctx.accounts.config;
        config.admin = admin;
        config.verifier = verifier;
        config.oracle = oracle;
        config.bump = ctx.bumps.config;

        emit!(ConfigInitialized {
            admin,
            verifier,
            oracle,
        });
        Ok(())
    }

    /// Rotate every role in one atomic transaction, signed by the current
    /// admin. This is how authority moves to (for example) a Squads vault:
    /// pass the vault address as the new `admin` — no upgrade, no redeploy.
    pub fn set_roles(
        ctx: Context<SetRoles>,
        admin: Pubkey,
        verifier: Pubkey,
        oracle: Pubkey,
    ) -> Result<()> {
        // A default admin would brick every future rotation (no key can sign
        // for it); verifier/oracle may be parked on an un-signable key on purpose.
        require!(admin != Pubkey::default(), FarmError::UnauthorisedAdmin);

        let config = &mut ctx.accounts.config;
        config.admin = admin;
        config.verifier = verifier;
        config.oracle = oracle;

        emit!(RolesRotated {
            admin,
            verifier,
            oracle,
        });
        Ok(())
    }

    // =========================================================================
    //  LAYER 1 — SCOUTING
    // =========================================================================

    /// Create a farm PDA for the signing owner.
    pub fn register_farm(
        ctx: Context<RegisterFarm>,
        name: String,
        lat_e6: i64,
        lng_e6: i64,
    ) -> Result<()> {
        require!(name.len() <= 64, FarmError::NameTooLong);

        let farm = &mut ctx.accounts.farm;
        farm.owner = ctx.accounts.owner.key();
        farm.name = name;
        farm.lat_e6 = lat_e6;
        farm.lng_e6 = lng_e6;
        farm.report_count = 0;
        farm.batch_count = 0;
        farm.verified_report_count = 0;
        farm.bump = ctx.bumps.farm;

        emit!(FarmRegistered {
            farm: farm.key(),
            owner: farm.owner,
        });
        Ok(())
    }

    /// Close the farm record and return its rent to the owner.
    ///
    /// Ownership is enforced twice over: the PDA seeds bind the farm to the
    /// signing owner, and `has_one` double-checks the stored owner field.
    /// Child accounts — scout reports, harvest batches, policies — are not
    /// touched: their evidence stays on chain as an independent trail, and
    /// every PDA derived from the farm address stays re-derivable after the
    /// account itself is gone.
    pub fn delete_farm(ctx: Context<DeleteFarm>) -> Result<()> {
        emit!(FarmDeleted {
            farm: ctx.accounts.farm.key(),
            owner: ctx.accounts.owner.key(),
        });
        Ok(())
    }

    /// Submit a new scout report (photo hash + GPS + AI label).
    pub fn submit_scout_report(
        ctx: Context<SubmitScoutReport>,
        photo_hash: [u8; 32],
        uri: String,
        lat_e6: i64,
        lng_e6: i64,
        ai_label: String,
    ) -> Result<()> {
        require!(uri.len() <= 128, FarmError::UriTooLong);
        require!(ai_label.len() <= 32, FarmError::LabelTooLong);

        let farm = &mut ctx.accounts.farm;
        let report = &mut ctx.accounts.report;

        report.farm = farm.key();
        report.reporter = ctx.accounts.reporter.key();
        report.index = farm.report_count;
        report.photo_hash = photo_hash;
        report.uri = uri;
        report.lat_e6 = lat_e6;
        report.lng_e6 = lng_e6;
        report.ai_label = ai_label;
        report.status = ReportStatus::Pending;
        report.verifier = Pubkey::default();
        report.timestamp = Clock::get()?.unix_timestamp;
        report.bump = ctx.bumps.report;

        farm.report_count = farm
            .report_count
            .checked_add(1)
            .ok_or(FarmError::Overflow)?;

        emit!(ScoutReportSubmitted {
            farm: farm.key(),
            report: report.key(),
            index: report.index,
        });
        Ok(())
    }

    /// Approve or reject a pending scout report.
    // =========================================================================
    //  LAYER 1 — VERIFIER SET (K-of-N quorum replaces the single verifier)
    // =========================================================================

    /// Bootstrap the verifier set once: quorum `k` and the USDC bond each
    /// member must post. Membership is earned separately via `post_bond`, so
    /// this only fixes the rules — governance (`config.admin`) owns them.
    /// `reconfigure_verifier_set` rewrites them later under the same bounds.
    pub fn init_verifier_set(ctx: Context<InitVerifierSet>, k: u8, bond_amount: u64) -> Result<()> {
        require!(k >= 2 && k <= MAX_VERIFIERS as u8, FarmError::InvalidQuorum);
        require!(bond_amount > 0, FarmError::ZeroBond);

        let set = &mut ctx.accounts.verifier_set;
        set.k = k;
        set.bond_amount = bond_amount;
        set.members = Vec::new();
        set.bump = ctx.bumps.verifier_set;

        emit!(VerifierSetInitialized { k, bond_amount });
        Ok(())
    }

    /// Governed reconfiguration: `config.admin` rewrites `k` and the seat
    /// price with the same bounds init ran under. Deliberately NOT coupled to
    /// the current member count — re-quoruming a stuck set in either
    /// direction is governance's explicit, reversible call. Repricing the
    /// bond affects FUTURE joins only: every seat keeps the stake it posted.
    ///
    /// Ops rule: finish open tallies before lowering `k`. `cast_vote`
    /// freezes a tally whose side already reaches the new `k` on next
    /// contact, but a split tally where every member has already voted can
    /// no longer progress — each further vote fails `AlreadyVoted`.
    pub fn reconfigure_verifier_set(
        ctx: Context<ReconfigureVerifierSet>,
        k: u8,
        bond_amount: u64,
    ) -> Result<()> {
        require!(k >= 2 && k <= MAX_VERIFIERS as u8, FarmError::InvalidQuorum);
        require!(bond_amount > 0, FarmError::ZeroBond);

        let set = &mut ctx.accounts.verifier_set;
        set.k = k;
        set.bond_amount = bond_amount;

        emit!(VerifierSetReconfigured { k, bond_amount });
        Ok(())
    }

    /// Join the set by posting the bond: the member's own USDC account pays
    /// into the program-held bond vault, so the seat — not the protocol —
    /// carries the collateral. Bonds leave only three ways: back to the member
    /// via `remove_verifier` or a governed `release_verifier`, or to the
    /// treasury via a governed slash. Each seat records exactly what it paid,
    /// so repricing `bond_amount` never moves someone else's collateral.
    pub fn post_bond(ctx: Context<PostBond>) -> Result<()> {
        let member = ctx.accounts.member.key();
        let set = &mut ctx.accounts.verifier_set;
        require!(
            !set.members.iter().any(|m| m.pubkey == member),
            FarmError::AlreadyVerifier
        );
        require!(set.members.len() < MAX_VERIFIERS, FarmError::VerifierSetFull);
        let bond = set.bond_amount;
        set.members.push(VerifierMember {
            pubkey: member,
            stake: bond,
        });

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.member_usdc.to_account_info(),
                    to: ctx.accounts.bond_vault.to_account_info(),
                    authority: ctx.accounts.member.to_account_info(),
                },
            ),
            bond,
        )?;

        emit!(VerifierJoined { member, bond });
        Ok(())
    }

    /// Leave the set with the bond returned — a voluntary exit keeps a
    /// captured verifier from being frozen out of their own collateral.
    /// Quorum floor: while the set stands at (or below) `k` members, nobody
    /// may walk — the seat stays until governance `release_verifier`s it or a
    /// new one bonds. Votes already cast on open tallies keep counting.
    pub fn remove_verifier(ctx: Context<RemoveVerifier>) -> Result<()> {
        let member = ctx.accounts.member.key();
        let set = &mut ctx.accounts.verifier_set;
        let position = set
            .members
            .iter()
            .position(|m| m.pubkey == member)
            .ok_or(FarmError::UnauthorisedVerifier)?;
        // Floor after the membership lookup, so a stranger still fails as
        // UnauthorisedVerifier rather than tripping the quorum rule.
        require!(set.members.len() > set.k as usize, FarmError::DropBelowQuorum);
        let stake = set.members.remove(position).stake;

        let seeds = [b"verifier_set".as_ref(), &[ctx.bumps.verifier_set]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.bond_vault.to_account_info(),
                    to: ctx.accounts.member_usdc.to_account_info(),
                    authority: ctx.accounts.verifier_set.to_account_info(),
                },
                &[&seeds[..]],
            ),
            stake,
        )?;

        emit!(VerifierExited { member, bond: stake });
        Ok(())
    }

    /// Governed fair exit: `config.admin` frees a seat without penalty and
    /// the bond goes back to that member's own USDC account — the benign
    /// twin of `slash_verifier` (which forfeits to the treasury).
    /// Unconditional by design: like the slash it may take a set below `k`,
    /// and it is the valve that keeps the quorum floor from becoming a trap.
    pub fn release_verifier(ctx: Context<ReleaseVerifier>, target: Pubkey) -> Result<()> {
        // The refund destination must be the released member's own account —
        // checked here rather than in a constraint, because instruction args
        // are not in scope there.
        require!(
            ctx.accounts.member_usdc.owner == target,
            FarmError::TokenAccountInvalid
        );

        let set = &mut ctx.accounts.verifier_set;
        let position = set
            .members
            .iter()
            .position(|m| m.pubkey == target)
            .ok_or(FarmError::UnauthorisedVerifier)?;
        let stake = set.members.remove(position).stake;

        let seeds = [b"verifier_set".as_ref(), &[ctx.bumps.verifier_set]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.bond_vault.to_account_info(),
                    to: ctx.accounts.member_usdc.to_account_info(),
                    authority: ctx.accounts.verifier_set.to_account_info(),
                },
                &[&seeds[..]],
            ),
            stake,
        )?;

        emit!(VerifierReleased { member: target, amount: stake });
        Ok(())
    }

    /// Governed slash: `config.admin` removes a member and moves their bond
    /// to the protocol treasury. Phase 1 deliberately ships no *automatic*
    /// slashing rules — minority/abstention economics get designed against
    /// real verifier behaviour, not invented up front. This is the honest
    /// lever until then: explicit, admin-gated, evented.
    pub fn slash_verifier(ctx: Context<SlashVerifier>, target: Pubkey) -> Result<()> {
        let set = &mut ctx.accounts.verifier_set;
        let position = set
            .members
            .iter()
            .position(|m| m.pubkey == target)
            .ok_or(FarmError::UnauthorisedVerifier)?;
        // Takes exactly the stake this seat posted — unconditional by design
        // (governance may take a set below `k` this way), and a later
        // bond-price change never moves it.
        let stake = set.members.remove(position).stake;

        let seeds = [b"verifier_set".as_ref(), &[ctx.bumps.verifier_set]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.bond_vault.to_account_info(),
                    to: ctx.accounts.treasury_usdc.to_account_info(),
                    authority: ctx.accounts.verifier_set.to_account_info(),
                },
                &[&seeds[..]],
            ),
            stake,
        )?;

        emit!(VerifierSlashed { member: target, amount: stake });
        Ok(())
    }

    /// Cast one quorum vote on a pending report — any bonded member, one
    /// vote each. The first side to reach `verifier_set.k` finalises the
    /// report (an approval also bumps the farm's verified count); from then
    /// on the report's `Pending` gate closes the tally, so late votes fail
    /// honestly instead of flipping a result.
    pub fn cast_vote(ctx: Context<CastVote>, approve: bool) -> Result<()> {
        let voter = ctx.accounts.voter.key();
        let k = ctx.accounts.verifier_set.k;
        let tally = &mut ctx.accounts.tally;

        // Freeze-on-contact: governance may lower `k` while a tally is open.
        // If a side already stands at `k` as the counts are, this call
        // finalises the report without recording the caller's ballot — which
        // is what stops an already-voted member set from deadlocking on
        // AlreadyVoted after such a change.
        if tally.approvals >= k || tally.rejections >= k {
            let approved = tally.approvals >= k;
            return finalise_report(&mut ctx.accounts.report, &mut ctx.accounts.farm, voter, approved);
        }

        require!(
            !tally.votes.iter().any(|vote| vote.voter == voter),
            FarmError::AlreadyVoted
        );

        tally.votes.push(TallyVote { voter, approve });
        if approve {
            tally.approvals = tally.approvals.checked_add(1).ok_or(FarmError::Overflow)?;
        } else {
            tally.rejections = tally.rejections.checked_add(1).ok_or(FarmError::Overflow)?;
        }
        let (approvals, rejections) = (tally.approvals, tally.rejections);
        emit!(VoteCast {
            report: ctx.accounts.report.key(),
            voter,
            approve,
            approvals,
            rejections,
        });

        if approvals >= k || rejections >= k {
            finalise_report(&mut ctx.accounts.report, &mut ctx.accounts.farm, voter, approvals >= k)?;
        }
        Ok(())
    }

    /// Transfer SKR tokens from the reward vault to the reporter. Anyone may
    /// trigger it once a quorum approved the report: the destination is
    /// pinned to `report.reporter` and the amount is protocol-fixed, so a
    /// caller can neither redirect nor inflate the payout — the state
    /// machine (Pending → Verified → Rewarded) is the whole gate.
    pub fn reward_report(ctx: Context<RewardReport>) -> Result<()> {
        let report = &mut ctx.accounts.report;
        require!(
            report.status == ReportStatus::Verified,
            FarmError::NotVerified
        );

        let seeds = &[b"reward_authority".as_ref(), &[ctx.bumps.reward_authority]];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    to: ctx.accounts.reporter_token_account.to_account_info(),
                    authority: ctx.accounts.reward_authority.to_account_info(),
                },
                signer,
            ),
            REPORT_REWARD,
        )?;

        // Mark as paid so the vault cannot be drained twice for one report
        report.status = ReportStatus::Rewarded;

        emit!(ReportRewarded {
            report: report.key(),
            reporter: report.reporter,
            amount: REPORT_REWARD,
        });
        Ok(())
    }

    // =========================================================================
    //  LAYER 2 — HARVEST & ESCROW
    // =========================================================================

    /// Record a harvest batch on-chain. GPS + timestamp prove provenance.
    /// Buyers can inspect the farm's scouting history alongside this record.
    ///
    /// PDA seeds: [b"batch", farm, batch_index (u32 LE)]
    pub fn submit_harvest_batch(
        ctx: Context<SubmitHarvestBatch>,
        photo_hash: [u8; 32],
        uri: String, // IPFS / Arweave manifest URI (max 128)
        lat_e6: i64,
        lng_e6: i64,
        crop: String,     // e.g. "maize" (max 32)
        quantity_kg: u64, // Net weight in kg
        notes: String,    // Buyer-facing notes (max 256)
    ) -> Result<()> {
        require!(uri.len() <= 128, FarmError::UriTooLong);
        require!(crop.len() <= 32, FarmError::LabelTooLong);
        require!(notes.len() <= 256, FarmError::NotesTooLong);
        require!(quantity_kg > 0, FarmError::ZeroQuantity);

        let farm = &mut ctx.accounts.farm;
        let batch = &mut ctx.accounts.batch;

        batch.farm = farm.key();
        batch.farmer = ctx.accounts.farmer.key();
        batch.index = farm.batch_count;
        batch.photo_hash = photo_hash;
        batch.uri = uri;
        batch.lat_e6 = lat_e6;
        batch.lng_e6 = lng_e6;
        batch.crop = crop;
        batch.quantity_kg = quantity_kg;
        batch.notes = notes;
        // Snapshot the farm's scouting history at time of harvest
        batch.scout_reports_at_harvest = farm.report_count;
        batch.verified_reports_at_harvest = farm.verified_report_count;
        batch.timestamp = Clock::get()?.unix_timestamp;
        batch.bump = ctx.bumps.batch;

        farm.batch_count = farm.batch_count.checked_add(1).ok_or(FarmError::Overflow)?;

        emit!(HarvestBatchSubmitted {
            farm: farm.key(),
            batch: batch.key(),
            index: batch.index,
            quantity_kg,
        });
        Ok(())
    }

    /// Buyer deposits USDC into an escrow PDA tied to a specific harvest batch.
    /// Funds are locked until the farmer releases or the buyer cancels (before lock).
    ///
    /// PDA seeds: [b"escrow", batch]
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        amount_usdc: u64, // Amount in USDC lamports (6 decimals)
        lock_until: i64,  // Unix timestamp after which buyer cannot cancel
    ) -> Result<()> {
        require!(amount_usdc > 0, FarmError::ZeroAmount);

        let escrow = &mut ctx.accounts.escrow;
        escrow.batch = ctx.accounts.batch.key();
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.farmer = ctx.accounts.batch.farmer;
        escrow.amount_usdc = amount_usdc;
        escrow.lock_until = lock_until;
        escrow.state = EscrowState::Funded;
        escrow.bump = ctx.bumps.escrow;

        // Transfer USDC from buyer into the escrow vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_usdc.to_account_info(),
                    to: ctx.accounts.escrow_vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            amount_usdc,
        )?;

        emit!(EscrowCreated {
            escrow: escrow.key(),
            batch: escrow.batch,
            buyer: escrow.buyer,
            amount_usdc,
        });
        Ok(())
    }

    /// Farmer releases the escrow, transferring funds to their wallet.
    /// Only callable by the farmer named on the batch.
    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Funded,
            FarmError::EscrowNotFunded
        );

        escrow.state = EscrowState::Released;
        let amount = escrow.amount_usdc;

        let seeds = &[b"escrow".as_ref(), escrow.batch.as_ref(), &[escrow.bump]];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.farmer_usdc.to_account_info(),
                    authority: escrow.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        emit!(EscrowReleased {
            escrow: escrow.key(),
            farmer: escrow.farmer,
            amount_usdc: amount,
        });
        Ok(())
    }

    /// Buyer cancels and reclaims funds ONLY before the lock_until timestamp.
    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Funded,
            FarmError::EscrowNotFunded
        );

        let now = Clock::get()?.unix_timestamp;
        require!(now < escrow.lock_until, FarmError::EscrowLocked);

        escrow.state = EscrowState::Cancelled;
        let amount = escrow.amount_usdc;

        let seeds = &[b"escrow".as_ref(), escrow.batch.as_ref(), &[escrow.bump]];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.buyer_usdc.to_account_info(),
                    authority: escrow.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        // Close the vault through the token program (its owner): rent returns
        // to the buyer and the batch's vault slot is freed for a retry.
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::CloseAccount {
                account: ctx.accounts.escrow_vault.to_account_info(),
                destination: ctx.accounts.buyer.to_account_info(),
                authority: escrow.to_account_info(),
            },
            signer,
        ))?;

        emit!(EscrowCancelled {
            escrow: escrow.key(),
            buyer: escrow.buyer,
            amount_usdc: amount,
        });
        Ok(())
    }

    // =========================================================================
    //  LAYER 3 — INSURANCE
    // =========================================================================

    /// Farmer creates a parametric insurance policy.
    /// Coverage pays out in USDC when the weather trigger fires.
    /// The farmer's scouting history can reduce the premium rate.
    ///
    /// The farmer pays the premium alone; the treasury tops the vault up with
    /// the coverage amount in a separate transfer, so a mobile wallet only
    /// ever needs one signature.
    ///
    /// PDA seeds: [b"policy", farm, policy_index (u32 LE)]
    pub fn create_policy(
        ctx: Context<CreatePolicy>,
        crop: String,              // max 32
        coverage_usdc: u64,        // Total payout if trigger fires
        premium_usdc: u64,         // Up-front premium paid by farmer
        trigger_threshold_mm: u32, // Rainfall shortfall trigger (mm × 10)
        season_start: i64,         // Unix timestamp
        season_end: i64,           // Unix timestamp
    ) -> Result<()> {
        require!(crop.len() <= 32, FarmError::LabelTooLong);
        require!(coverage_usdc > 0, FarmError::ZeroAmount);
        require!(premium_usdc > 0, FarmError::ZeroAmount);
        require!(season_end > season_start, FarmError::InvalidSeason);

        let farm = &ctx.accounts.farm;
        let policy = &mut ctx.accounts.policy;

        policy.farm = farm.key();
        policy.farmer = ctx.accounts.farmer.key();
        policy.index = ctx.accounts.farm.policy_count;
        policy.crop = crop;
        policy.coverage_usdc = coverage_usdc;
        policy.premium_usdc = premium_usdc;
        policy.trigger_threshold_mm = trigger_threshold_mm;
        policy.season_start = season_start;
        policy.season_end = season_end;
        // Snapshot scout history for claim evidence / premium discount calc
        policy.verified_reports_at_creation = farm.verified_report_count;
        policy.state = PolicyState::Active;
        policy.bump = ctx.bumps.policy;

        // Farmer pays the premium into the insurance vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.farmer_usdc.to_account_info(),
                    to: ctx.accounts.insurance_vault.to_account_info(),
                    authority: ctx.accounts.farmer.to_account_info(),
                },
            ),
            premium_usdc,
        )?;

        // The coverage amount is funded by the treasury with a plain token
        // transfer into the vault after creation — no co-signer here.

        // Increment policy count on farm
        ctx.accounts.farm.policy_count = ctx
            .accounts
            .farm
            .policy_count
            .checked_add(1)
            .ok_or(FarmError::Overflow)?;

        emit!(PolicyCreated {
            policy: policy.key(),
            farm: policy.farm,
            coverage_usdc,
            trigger_threshold_mm,
        });
        Ok(())
    }

    /// An authorised weather oracle posts a rainfall reading for a farm/season.
    ///
    /// PDA seeds: [b"weather", farm, season_start (i64 LE)]
    // =========================================================================
    //  LAYER 3 — ORACLE SET (median of k readers replaces the single key)
    // =========================================================================

    /// Bootstrap the reader set once: how many readers make a season reading
    /// official. k must be odd and at least 3, so the median is a single
    /// unambiguous middle value — and so no single key can be "the oracle".
    pub fn init_oracle_set(ctx: Context<InitOracleSet>, k: u8) -> Result<()> {
        require!(
            k >= 3 && k <= MAX_ORACLES as u8 && k % 2 == 1,
            FarmError::InvalidMedianQuorum
        );

        let set = &mut ctx.accounts.oracle_set;
        set.k = k;
        set.members = Vec::new();
        set.bump = ctx.bumps.oracle_set;

        emit!(OracleSetInitialized { k });
        Ok(())
    }

    /// Add a reader (`config.admin` assigns seats — no bond, because the
    /// median itself is the defence: one liar cannot move the middle value).
    pub fn add_oracle(ctx: Context<ManageOracle>, member: Pubkey) -> Result<()> {
        let set = &mut ctx.accounts.oracle_set;
        require!(!set.members.contains(&member), FarmError::AlreadyOracle);
        require!(set.members.len() < MAX_ORACLES, FarmError::OracleSetFull);
        set.members.push(member);

        emit!(OracleJoined { member });
        Ok(())
    }

    /// Remove a reader (`config.admin`). Readings they already posted stay in
    /// the tally — a removed reader cannot un-notice a season.
    pub fn remove_oracle(ctx: Context<ManageOracle>, member: Pubkey) -> Result<()> {
        let set = &mut ctx.accounts.oracle_set;
        let position = set
            .members
            .iter()
            .position(|m| *m == member)
            .ok_or(FarmError::UnauthorisedOracle)?;
        set.members.remove(position);

        emit!(OracleRemoved { member });
        Ok(())
    }

    /// Post (or replace, before quorum) this reader's season rainfall.
    /// Reaching `oracle_set.k` readings computes the median — the middle of
    /// the sorted readings — freezes it into `total_rainfall_mm`, stamps
    /// `reading_timestamp`, and closes the account: later submissions fail
    /// the `finalized` gate instead of moving a settled number.
    pub fn submit_oracle_reading(
        ctx: Context<SubmitOracleReading>,
        season_start: i64,
        total_rainfall_mm: u32, // Accumulated rainfall for the season (mm × 10)
    ) -> Result<()> {
        // One tally writer with the receipt path below, so a reader and a
        // relayed Switchboard receipt can never behave differently.
        let member = ctx.accounts.member.key();
        let farm = ctx.accounts.farm.key();
        let k = ctx.accounts.oracle_set.k;
        let (created, froze, official) = record_reading(
            &mut ctx.accounts.oracle,
            member,
            farm,
            season_start,
            total_rainfall_mm,
            ctx.bumps.oracle,
            k,
        )?;

        emit!(WeatherReadingSubmitted {
            oracle: ctx.accounts.oracle.key(),
            farm,
            total_rainfall_mm,
            created,
        });
        if froze {
            emit!(WeatherMedianFinalized {
                oracle: ctx.accounts.oracle.key(),
                farm,
                total_rainfall_mm: official,
                readings: k,
            });
        }
        Ok(())
    }

    // =========================================================================
    //  LAYER 3B — SWITCHBOARD RECEIPT READING (role-1: one seat at the table)
    // =========================================================================

    /// Pin — or re-pin — the trust root for one farm/season's Switchboard
    /// On-Demand job: the feed that holds an oracle-set seat, the fingerprint
    /// of the exact task bytes its enclaves sign over, and the enclave keys
    /// allowed to sign. `config.admin` only, mirroring how seats are assigned;
    /// re-run it whenever the queue rotates its enclaves.
    pub fn register_switchboard_feed(
        ctx: Context<RegisterSwitchboardFeed>,
        season_start: i64,
        feed: Pubkey,
        feed_hash: [u8; 32],
        signers: Vec<Pubkey>,
    ) -> Result<()> {
        require!(
            signers.len() >= SWITCHBOARD_MIN_SIGNERS,
            FarmError::InvalidFeedRegistration
        );
        let mut distinct: Vec<Pubkey> = Vec::with_capacity(signers.len());
        for signer in &signers {
            require!(!distinct.contains(signer), FarmError::InvalidFeedRegistration);
            distinct.push(*signer);
        }

        let binding = &mut ctx.accounts.binding;
        binding.farm = ctx.accounts.farm.key();
        binding.season_start = season_start;
        binding.feed = feed;
        binding.feed_hash = feed_hash;
        binding.signers = signers;
        binding.bump = ctx.bumps.binding;

        emit!(SwitchboardFeedRegistered {
            farm: binding.farm,
            feed,
            feed_hash,
            signers: binding.signers.len() as u8,
        });
        Ok(())
    }

    /// Relay a Switchboard receipt into the season tally. Permissionless by
    /// construction: anyone may carry the bytes — the reading's authority is
    /// the receipt itself, checked here against the admin-pinned binding:
    /// this transaction's Ed25519 precompile proved the signatures, the
    /// signed message is the 81-byte receipt layout for THE bound feed hash,
    /// the signing keys are that feed's pinned enclaves, and the signed
    /// slothash is still inside SlotHashes (≤512 slots old, so a receipt
    /// cannot be replayed once the round it describes has cooled). The value
    /// then enters the tally under the feed's seat and behaves exactly like
    /// a reader's own submission — replaceable while the tally is open,
    /// frozen into the median at k, untouchable once `finalized`.
    pub fn submit_switchboard_reading(
        ctx: Context<SubmitSwitchboardReading>,
        season_start: i64,
        feed: Pubkey,
    ) -> Result<()> {
        let total_rainfall_mm = verify_switchboard_receipt(
            &ctx.accounts.instructions,
            &ctx.accounts.slot_hashes,
            &ctx.accounts.binding,
        )?;

        let farm = ctx.accounts.farm.key();
        let k = ctx.accounts.oracle_set.k;
        let (created, froze, official) = record_reading(
            &mut ctx.accounts.oracle,
            feed,
            farm,
            season_start,
            total_rainfall_mm,
            ctx.bumps.oracle,
            k,
        )?;

        emit!(WeatherReadingSubmitted {
            oracle: ctx.accounts.oracle.key(),
            farm,
            total_rainfall_mm,
            created,
        });
        if froze {
            emit!(WeatherMedianFinalized {
                oracle: ctx.accounts.oracle.key(),
                farm,
                total_rainfall_mm: official,
                readings: k,
            });
        }
        Ok(())
    }

    /// Settle a policy against a weather reading.
    ///
    /// If rainfall < threshold  → payout fires, farmer receives coverage_usdc.
    /// If rainfall >= threshold → no payout, the treasury reclaims coverage.
    /// In both cases the premium stays in the policy vault.
    pub fn settle_policy(ctx: Context<SettlePolicy>) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        let oracle = &ctx.accounts.oracle;

        require!(
            policy.state == PolicyState::Active,
            FarmError::PolicyNotActive
        );
        require!(oracle.farm == policy.farm, FarmError::OracleFarmMismatch);
        require!(
            oracle.season_start == policy.season_start,
            FarmError::OracleSeasonMismatch
        );
        // The number that settles money must be the frozen median, not a
        // partial tally that simply has an account.
        require!(oracle.finalized, FarmError::ReadingNotFinalized);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= policy.season_end, FarmError::SeasonNotEnded);

        // Copy everything we need off the borrow before the CPI
        let (farm_key, policy_key, index, bump, coverage_usdc, trigger_mm, rainfall_mm) = (
            policy.farm,
            policy.key(),
            policy.index,
            policy.bump,
            policy.coverage_usdc,
            policy.trigger_threshold_mm,
            oracle.total_rainfall_mm,
        );

        let seeds = &[
            b"policy".as_ref(),
            farm_key.as_ref(),
            &index.to_le_bytes(),
            &[bump],
        ];
        let signer = &[&seeds[..]];

        if rainfall_mm < trigger_mm {
            // Trigger fired — pay the farmer
            policy.state = PolicyState::PaidOut;

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.insurance_vault.to_account_info(),
                        to: ctx.accounts.farmer_usdc.to_account_info(),
                        authority: ctx.accounts.policy.to_account_info(),
                    },
                    signer,
                ),
                coverage_usdc,
            )?;

            emit!(PolicySettled {
                policy: policy_key,
                triggered: true,
                payout_usdc: coverage_usdc,
                rainfall_mm,
            });
        } else {
            // No trigger — coverage returns to the treasury that funded it
            policy.state = PolicyState::Expired;

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.insurance_vault.to_account_info(),
                        to: ctx.accounts.insurer_usdc.to_account_info(),
                        authority: ctx.accounts.policy.to_account_info(),
                    },
                    signer,
                ),
                coverage_usdc,
            )?;

            emit!(PolicySettled {
                policy: policy_key,
                triggered: false,
                payout_usdc: 0,
                rainfall_mm,
            });
        }

        Ok(())
    }

    /// Revoke an active policy before the season ends.
    ///
    /// The farmer's premium comes back out of the policy vault, whatever the
    /// treasury funded beyond it returns to the treasury, and both the empty
    /// vault and the policy account close — their rents go back to the farmer.
    /// Revocation is refused once the season is over: from then on the policy
    /// must go through `settle_policy`, so a farmer can never reclaim the
    /// premium to dodge a dry-season payout check.
    pub fn revoke_policy(ctx: Context<RevokePolicy>) -> Result<()> {
        let policy = &ctx.accounts.policy;
        require!(policy.state == PolicyState::Active, FarmError::PolicyNotActive);

        let now = Clock::get()?.unix_timestamp;
        require!(now < policy.season_end, FarmError::RevocationWindowClosed);

        // Copy everything we need off the borrow before the CPIs.
        let (farm_key, index, bump, premium, farmer) = (
            policy.farm,
            policy.index,
            policy.bump,
            policy.premium_usdc,
            policy.farmer,
        );
        let policy_key = policy.key();

        let seeds = &[
            b"policy".as_ref(),
            farm_key.as_ref(),
            &index.to_le_bytes(),
            &[bump],
        ];
        let signer = &[&seeds[..]];

        // 1. Premium back to the farmer.
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.insurance_vault.to_account_info(),
                    to: ctx.accounts.farmer_usdc.to_account_info(),
                    authority: ctx.accounts.policy.to_account_info(),
                },
                signer,
            ),
            premium,
        )?;

        // 2. Anything the treasury deposited beyond the premium goes back to
        //    it, leaving the vault exactly empty.
        let remainder = ctx
            .accounts
            .insurance_vault
            .amount
            .saturating_sub(premium);
        if remainder > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.insurance_vault.to_account_info(),
                        to: ctx.accounts.insurer_usdc.to_account_info(),
                        authority: ctx.accounts.policy.to_account_info(),
                    },
                    signer,
                ),
                remainder,
            )?;
        }

        // 3. Close the empty vault through the token program (its owner):
        //    rent returns to the farmer. Anchor's `close` on the policy runs
        //    after this handler and refunds that rent too.
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::CloseAccount {
                account: ctx.accounts.insurance_vault.to_account_info(),
                destination: ctx.accounts.farmer.to_account_info(),
                authority: ctx.accounts.policy.to_account_info(),
            },
            signer,
        ))?;

        emit!(PolicyRevoked {
            policy: policy_key,
            farmer,
            premium_refunded_usdc: premium,
        });
        Ok(())
    }

    /// Move accumulated refunds out of the program treasury into the admin's
    /// own USDC account. The treasury PDA signs the transfer, so custody sits
    /// with the program until governance decides otherwise — an EOA admin
    /// today, a Squads vault after `set_roles`.
    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
        let bump = ctx.bumps.treasury;
        let seeds = [b"treasury".as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.treasury_usdc.to_account_info(),
                    to: ctx.accounts.destination_usdc.to_account_info(),
                    authority: ctx.accounts.treasury.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        emit!(TreasuryWithdrawn {
            amount,
            destination: ctx.accounts.destination_usdc.key(),
        });
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared handlers — one tally writer and one receipt verifier, each used by
//  more than one instruction. Kept outside the #[program] mod so neither can
//  be mistaken for an instruction of its own.
// ─────────────────────────────────────────────────────────────────────────────

/// Record one reading against a season tally under `identity` and freeze the
/// median the moment `k` readings stand. Shared by the reader path
/// (`submit_oracle_reading`) and the receipt path
/// (`submit_switchboard_reading`) so the two can never drift: a source
/// corrects its own entry while the tally is open — never double-weighting
/// itself — and nothing moves after `finalized`.
/// Returns `(created, froze, official)`.
fn record_reading(
    oracle: &mut WeatherOracle,
    identity: Pubkey,
    farm: Pubkey,
    season_start: i64,
    total_rainfall_mm: u32,
    bump: u8,
    k: u8,
) -> Result<(bool, bool, u32)> {
    require!(!oracle.finalized, FarmError::ReadingFinalized);

    // A freshly initialised account is zeroed, so an unset farm is the
    // tell that this call created the account (the season's first reading).
    let created = oracle.farm == Pubkey::default();
    oracle.farm = farm;
    oracle.season_start = season_start;
    oracle.bump = bump;

    match oracle.readings.iter_mut().find(|r| r.oracle == identity) {
        // Own replacement while the tally is open — a typo must not be
        // counted, and it can never double-weight the source.
        Some(reading) => reading.total_rainfall_mm = total_rainfall_mm,
        None => oracle.readings.push(OracleReading {
            oracle: identity,
            total_rainfall_mm,
        }),
    }

    let k_usize = k as usize;
    if oracle.readings.len() >= k_usize {
        oracle.readings.sort_by_key(|r| r.total_rainfall_mm);
        // k is odd and the tally froze at exactly k readings, so the
        // middle value is unambiguous.
        let official = oracle.readings[k_usize / 2].total_rainfall_mm;
        oracle.total_rainfall_mm = official;
        oracle.reading_timestamp = Clock::get()?.unix_timestamp;
        oracle.finalized = true;
        return Ok((created, true, official));
    }
    Ok((created, false, 0))
}

/// Verify the Switchboard receipt carried by this transaction's Ed25519
/// precompile instructions and return the rainfall it attests (mm × 10).
///
/// The trust chain, in order: (1) the precompile has already run when we
/// execute — a bad signature aborts the whole transaction — so the signer/
/// message pairs described by its offsets are proven true and we only
/// re-read them; (2) the message is the documented 81-byte receipt layout
/// and its feed hash equals the admin-pinned one, so a receipt for any other
/// job is a foreign object; (3) the signatures come from enclave keys the
/// admin pinned for this feed — with those keys honest, the value is the
/// job's answer rather than the relayer's; (4) the signed slothash (that
/// round's recent blockhash) must still sit in SlotHashes, so receipts die
/// with the ≤512-slot window instead of being replayable forever; (5) the
/// fixed-point value scales to a whole 0.1 mm — no rounding into a rainfall
/// nobody reported.
#[allow(deprecated)] // load_*_checked come from anchor's compat re-export
fn verify_switchboard_receipt<'info>(
    instructions: &AccountInfo<'info>,
    slot_hashes: &AccountInfo<'info>,
    binding: &SwitchboardFeedBinding,
) -> Result<u32> {
    let current = load_current_index_checked(instructions)
        .map_err(|_| error!(FarmError::InvalidSwitchboardReceipt))?
        as usize;
    let pairs = collect_ed25519_pairs(instructions, current)?;
    require!(!pairs.is_empty(), FarmError::InvalidSwitchboardReceipt);

    // Well-formed receipts for THE bound job are the candidates.
    let candidates: Vec<&Vec<u8>> = pairs
        .iter()
        .map(|(_, message)| message)
        .filter(|message| {
            message.len() == SWITCHBOARD_MESSAGE_LEN
                && message[32..64] == binding.feed_hash[..]
        })
        .collect();
    require!(!candidates.is_empty(), FarmError::InvalidSwitchboardReceipt);

    // One message must carry a quorum: at least three distinct pinned
    // enclave keys, and never fewer than the job's own min_oracle_samples.
    let mut receipt: Option<&Vec<u8>> = None;
    for message in candidates {
        let needed = (message[80] as usize).max(SWITCHBOARD_MIN_SIGNERS);
        let mut signers: Vec<&Pubkey> = Vec::new();
        for (signer, signed) in &pairs {
            if signed == message && binding.signers.contains(signer) && !signers.contains(&signer)
            {
                signers.push(signer);
            }
        }
        if signers.len() >= needed {
            receipt = Some(message);
            break;
        }
    }
    let receipt = receipt.ok_or(error!(FarmError::UnauthorisedSwitchboardSigner))?;

    // Freshness: the signed slothash must still be among the recent slots'
    // hashes — 8-byte bincode count, then count × (slot: u64 ‖ hash: 32).
    let slothash = &receipt[0..32];
    let data = slot_hashes
        .try_borrow_data()
        .map_err(|_| error!(FarmError::InvalidSwitchboardReceipt))?;
    require!(data.len() >= 8, FarmError::InvalidSwitchboardReceipt);
    let count = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
    require!(
        count <= 1024 && data.len() >= 8 + count * 40,
        FarmError::InvalidSwitchboardReceipt
    );
    let fresh = (0..count).any(|i| {
        let hash = 8 + i * 40 + 8; // skip the entry's slot number
        data[hash..hash + 32] == slothash[..]
    });
    require!(fresh, FarmError::StaleSwitchboardReceipt);

    // Job scale → tally unit: 18-decimal fixed-point, so 22.2 mm arrives as
    // 22_200_000_000_000_000_000 = 222 × 1e17.
    let raw = i128::from_le_bytes(receipt[64..80].try_into().unwrap());
    require!(raw >= 0, FarmError::InvalidSwitchboardValue);
    let raw = raw as u128;
    require!(
        raw % SWITCHBOARD_UNIT_SCALE == 0,
        FarmError::InvalidSwitchboardValue
    );
    let mm10 = raw / SWITCHBOARD_UNIT_SCALE;
    require!(mm10 <= u32::MAX as u128, FarmError::InvalidSwitchboardValue);
    Ok(mm10 as u32)
}

/// Walk the Ed25519SigVerify precompile instructions ahead of this one and
/// re-read the (signer, message) pairs their offsets describe. The runtime
/// program formats its offsets as `num_signatures(1) ‖ padding(1) ‖ n × 14
/// bytes` — signature offset/index, public-key offset/index, message
/// offset/size/index — where an index of 65535 means "this instruction"
/// (the sentinel both solana-sdk and web3.js emit, and the one the probe's
/// switchboard-built receipt uses).
#[allow(deprecated)] // load_instruction_at_checked comes from anchor's compat re-export
fn collect_ed25519_pairs(
    instructions_sysvar: &AccountInfo,
    own_index: usize,
) -> Result<Vec<(Pubkey, Vec<u8>)>> {
    let mut pairs: Vec<(Pubkey, Vec<u8>)> = Vec::new();
    for index in 0..own_index {
        let ix = load_instruction_at_checked(index, instructions_sysvar)
            .map_err(|_| error!(FarmError::InvalidSwitchboardReceipt))?;
        if ix.program_id != ED25519_VERIFY_PROGRAM {
            continue;
        }
        let data = ix.data;
        if data.len() < 2 {
            return err!(FarmError::InvalidSwitchboardReceipt);
        }
        let count = data[0] as usize;
        if data.len() < 2 + count * 14 {
            return err!(FarmError::InvalidSwitchboardReceipt);
        }
        for i in 0..count {
            let base = 2 + i * 14;
            let at = |offset: usize| -> usize {
                usize::from(u16::from_le_bytes([data[offset], data[offset + 1]]))
            };
            let (pk_off, pk_ix, msg_off, msg_sz, msg_ix) =
                (at(base + 4), at(base + 6), at(base + 8), at(base + 10), at(base + 12));
            let pk_data = if pk_ix == u16::MAX as usize || pk_ix == index {
                data.clone()
            } else {
                load_instruction_at_checked(pk_ix, instructions_sysvar)
                    .map_err(|_| error!(FarmError::InvalidSwitchboardReceipt))?
                    .data
            };
            let msg_data = if msg_ix == u16::MAX as usize || msg_ix == index {
                data.clone()
            } else {
                load_instruction_at_checked(msg_ix, instructions_sysvar)
                    .map_err(|_| error!(FarmError::InvalidSwitchboardReceipt))?
                    .data
            };
            if pk_off + 32 > pk_data.len() || msg_off + msg_sz > msg_data.len() {
                return err!(FarmError::InvalidSwitchboardReceipt);
            }
            let mut signer = [0u8; 32];
            signer.copy_from_slice(&pk_data[pk_off..pk_off + 32]);
            pairs.push((
                Pubkey::new_from_array(signer),
                msg_data[msg_off..msg_off + msg_sz].to_vec(),
            ));
        }
    }
    Ok(pairs)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Accounts
// ─────────────────────────────────────────────────────────────────────────────

/// Layer 0 — Program configuration: who may sign which ops gate.
///
/// One PDA (`seeds = [b"config"]`) replaces the hard-coded `ADMIN` const as
/// the source of truth for verify/reward/oracle/settle and for who may
/// withdraw from the program treasury. Roles are independent pubkeys so they
/// can be split across keys (or a multisig) without touching the program;
/// `admin` owns the rotation itself.
#[account]
pub struct Config {
    /// Governance: rotates every role below (including itself) and the only
    /// key allowed to withdraw from the program treasury.
    pub admin: Pubkey,
    /// Vestigial after Phase 1: report verification moved to the bonded
    /// K-of-N verifier set, and reward claims became permissionless. The
    /// field survives so the account layout doesn't migrate; `set_roles`
    /// still rotates it, but nothing gates on it.
    pub verifier: Pubkey,
    /// Vestigial after Phase 2: weather readings moved to the admin-managed
    /// oracle set's median. Kept so the account layout doesn't migrate;
    /// `set_roles` still rotates it, but nothing gates on it.
    pub oracle: Pubkey,
    pub bump: u8,
}
impl Config {
    pub const MAX_SIZE: usize = 32 + 32 + 32 + 1;
}

/// Layer 1 — Farm registry
#[account]
pub struct Farm {
    pub owner: Pubkey,
    pub name: String, // max 64
    pub lat_e6: i64,
    pub lng_e6: i64,
    pub report_count: u32,
    pub batch_count: u32,
    pub verified_report_count: u32, // Tally of verified scout reports
    pub policy_count: u32,
    pub bump: u8,
}
impl Farm {
    pub const MAX_SIZE: usize = 32 + (4 + 64) + 8 + 8 + 4 + 4 + 4 + 4 + 1;
}

/// Layer 1 — Scout report
#[account]
pub struct ScoutReport {
    pub farm: Pubkey,
    pub reporter: Pubkey,
    pub index: u32,
    pub photo_hash: [u8; 32],
    pub uri: String, // max 128
    pub lat_e6: i64,
    pub lng_e6: i64,
    pub ai_label: String, // max 32
    pub status: ReportStatus,
    /// The voter whose vote pushed the tally to quorum — finalizer, not
    /// sole authority (Phase 1 replaced the single verifier).
    pub verifier: Pubkey,
    pub timestamp: i64,
    pub bump: u8,
}
impl ScoutReport {
    pub const MAX_SIZE: usize = 32 + 32 + 4 + 32 + (4 + 128) + 8 + 8 + (4 + 32) + 1 + 32 + 8 + 1;
}

/// Phase 1 — K-of-N verifier set: membership with bonded stakes.
/// One PDA (seeds ["verifier_set"]) holds the quorum, the bond price of a
/// seat and the current members; per-report votes live in the `Tally`.
#[account]
pub struct VerifierSet {
    /// Quorum: first side to reach this many votes finalises the report.
    pub k: u8,
    /// USDC (atomic units) each seat costs — the price of a NEW join;
    /// `reconfigure_verifier_set` reprices it, affecting future joins only.
    pub bond_amount: u64,
    /// Bonded members with the exact stake each posted at join time: the
    /// figure an exit refunds and a slash takes, so repricing the set bond
    /// never moves someone else's collateral. Bounded by MAX_VERIFIERS so
    /// the account stays fixed-size.
    pub members: Vec<VerifierMember>,
    pub bump: u8,
}
impl VerifierSet {
    pub const MAX_SIZE: usize = 1 + 8 + 4 + ((32 + 8) * MAX_VERIFIERS) + 1;
}

/// One seat: the member and exactly what they paid for it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct VerifierMember {
    pub pubkey: Pubkey,
    pub stake: u64,
}

/// Phase 1 — per-report vote record (seeds ["tally", report]). Created by
/// the report's first vote; the report's Pending gate closes it once a side
/// reaches quorum, so late votes fail instead of flipping the result.
#[account]
pub struct Tally {
    pub report: Pubkey,
    pub approvals: u8,
    pub rejections: u8,
    pub votes: Vec<TallyVote>,
    pub bump: u8,
}
impl Tally {
    pub const MAX_SIZE: usize = 32 + 1 + 1 + 4 + ((32 + 1) * MAX_VERIFIERS) + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct TallyVote {
    pub voter: Pubkey,
    pub approve: bool,
}

/// Single finalisation path for `cast_vote`: a normal quorum-reaching vote
/// and the freeze-on-contact branch (a tally whose side already stands at
/// `k` after governance lowered it) share this, so a report can only ever
/// end in one place.
fn finalise_report(
    report: &mut Account<ScoutReport>,
    farm: &mut Account<Farm>,
    verifier: Pubkey,
    approved: bool,
) -> Result<()> {
    report.status = if approved {
        ReportStatus::Verified
    } else {
        ReportStatus::Rejected
    };
    report.verifier = verifier;

    if approved {
        farm.verified_report_count = farm
            .verified_report_count
            .checked_add(1)
            .ok_or(FarmError::Overflow)?;
    }

    emit!(ScoutReportVerified {
        report: report.key(),
        approved,
        verifier,
    });
    Ok(())
}

/// Layer 2 — Harvest batch with provenance snapshot
#[account]
pub struct HarvestBatch {
    pub farm: Pubkey,
    pub farmer: Pubkey,
    pub index: u32,
    pub photo_hash: [u8; 32],
    pub uri: String, // max 128
    pub lat_e6: i64,
    pub lng_e6: i64,
    pub crop: String, // max 32
    pub quantity_kg: u64,
    pub notes: String, // max 256
    /// Total scout reports on the farm when batch was submitted
    pub scout_reports_at_harvest: u32,
    /// Verified scout reports on the farm when batch was submitted
    pub verified_reports_at_harvest: u32,
    pub timestamp: i64,
    pub bump: u8,
}
impl HarvestBatch {
    pub const MAX_SIZE: usize =
        32 + 32 + 4 + 32 + (4 + 128) + 8 + 8 + (4 + 32) + 8 + (4 + 256) + 4 + 4 + 8 + 1;
}

/// Layer 2 — Escrow for buyer/farmer USDC settlement
#[account]
pub struct Escrow {
    pub batch: Pubkey,
    pub buyer: Pubkey,
    pub farmer: Pubkey,
    pub amount_usdc: u64,
    pub lock_until: i64,
    pub state: EscrowState,
    pub bump: u8,
}
impl Escrow {
    pub const MAX_SIZE: usize = 32 + 32 + 32 + 8 + 8 + 1 + 1;
}

/// Layer 3 — Parametric insurance policy
#[account]
pub struct Policy {
    pub farm: Pubkey,
    pub farmer: Pubkey,
    pub index: u32,
    pub crop: String, // max 32
    pub coverage_usdc: u64,
    pub premium_usdc: u64,
    pub trigger_threshold_mm: u32,
    pub season_start: i64,
    pub season_end: i64,
    pub verified_reports_at_creation: u32,
    pub state: PolicyState,
    pub bump: u8,
}
impl Policy {
    pub const MAX_SIZE: usize = 32 + 32 + 4 + (4 + 32) + 8 + 8 + 4 + 8 + 8 + 4 + 1 + 1;
}

/// Layer 3 — Season weather reading: a per-season tally whose frozen median
/// settles policies (Phase 2 replaces the single oracle key).
#[account]
pub struct WeatherOracle {
    pub farm: Pubkey,
    pub season_start: i64,
    /// Official median (mm × 10) — written when the quorum lands; 0 until.
    pub total_rainfall_mm: u32,
    /// When the quorum froze the median.
    pub reading_timestamp: i64,
    /// True once k readings landed — the only state `settle_policy` trusts.
    pub finalized: bool,
    /// One reading per oracle-set member (own replacement allowed
    /// pre-quorum), bounded by MAX_ORACLES.
    pub readings: Vec<OracleReading>,
    pub bump: u8,
}
impl WeatherOracle {
    pub const MAX_SIZE: usize = 32 + 8 + 4 + 8 + 1 + 4 + ((32 + 4) * MAX_ORACLES) + 1;
}

/// One reader's vote in the season tally.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct OracleReading {
    pub oracle: Pubkey,
    pub total_rainfall_mm: u32,
}

/// Phase 2 — the admin-managed reader set: odd quorum k + members, no bonds
/// (the median is the defence, not collateral).
#[account]
pub struct OracleSet {
    /// Odd, 3..=MAX_ORACLES: readings needed to freeze the median.
    pub k: u8,
    pub members: Vec<Pubkey>,
    pub bump: u8,
}
impl OracleSet {
    pub const MAX_SIZE: usize = 1 + 4 + (32 * MAX_ORACLES) + 1;
}

/// Phase 3B — the admin-pinned trust root for one Switchboard On-Demand
/// job. Role-1 means the receipt itself carries the authority, so this
/// account is the only thing that decides whose signatures count and for
/// which job: `feed_hash` fingerprints the exact task bytes (a receipt for
/// any other job fails the match), and `signers` are the queue's enclave
/// keys as of registration — re-pin them if the queue rotates.
#[account]
pub struct SwitchboardFeedBinding {
    pub farm: Pubkey,
    pub season_start: i64,
    /// The seat identity: occupies one oracle-set member slot and keys this
    /// feed's readings in the season tally.
    pub feed: Pubkey,
    /// Fingerprint of the job definition the enclaves sign over.
    pub feed_hash: [u8; 32],
    /// Enclave signer keys allowed to sign receipts for this binding.
    pub signers: Vec<Pubkey>,
    pub bump: u8,
}
impl SwitchboardFeedBinding {
    pub const MAX_SIZE: usize = 32 + 8 + 32 + 32 + 4 + (32 * MAX_ORACLES) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Enums
// ─────────────────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ReportStatus {
    Pending,
    Verified,
    Rejected,
    /// Reward already paid out — guards reward_report against double spends
    Rewarded,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EscrowState {
    Funded,
    Released,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PolicyState {
    Active,
    PaidOut,
    Expired,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Instruction Contexts
// ─────────────────────────────────────────────────────────────────────────────

// ── Layer 0 ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitConfig<'info> {
    /// Bootstrap gate: only the hard-coded `ADMIN` may create the config.
    #[account(mut, constraint = initializer.key() == ADMIN @ FarmError::UnauthorisedAdmin)]
    pub initializer: Signer<'info>,

    #[account(
        init,
        payer = initializer,
        space = 8 + Config::MAX_SIZE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetRoles<'info> {
    /// The current `config.admin` — checked against the stored role below.
    #[account(mut, constraint = authority.key() == config.admin @ FarmError::UnauthorisedAdmin)]
    pub authority: Signer<'info>,

    /// Seeded, self-referential authority: only the key stored here may
    /// rotate the roles stored here.
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
}

// ── Layer 1 ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct RegisterFarm<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Farm::MAX_SIZE,
        seeds = [b"farm", owner.key().as_ref()],
        bump
    )]
    pub farm: Account<'info, Farm>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitScoutReport<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,

    #[account(mut)]
    pub farm: Account<'info, Farm>,

    #[account(
        init,
        payer = reporter,
        space = 8 + ScoutReport::MAX_SIZE,
        seeds = [b"report", farm.key().as_ref(), &farm.report_count.to_le_bytes()],
        bump
    )]
    pub report: Account<'info, ScoutReport>,

    pub system_program: Program<'info, System>,
}

/// Bootstrap the rules: quorum + bond price, one shot (the PDA's `init`
/// refuses a second call). Membership itself arrives via `post_bond`.
#[derive(Accounts)]
pub struct InitVerifierSet<'info> {
    /// Role gate: only `config.admin` sets the rules. Also pays the PDA's
    /// rent on init, hence `mut`.
    #[account(mut, constraint = authority.key() == config.admin @ FarmError::UnauthorisedAdmin)]
    pub authority: Signer<'info>,

    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = authority,
        space = 8 + VerifierSet::MAX_SIZE,
        seeds = [b"verifier_set"],
        bump
    )]
    pub verifier_set: Account<'info, VerifierSet>,

    pub system_program: Program<'info, System>,
}

/// Governed reconfiguration of the verifier set — same gate and bounds as
/// init, but rewriting instead of creating. No payer: the PDA already exists
/// and its size does not change here.
#[derive(Accounts)]
pub struct ReconfigureVerifierSet<'info> {
    /// Role gate: only `config.admin` rewrites the rules.
    #[account(constraint = authority.key() == config.admin @ FarmError::UnauthorisedAdmin)]
    pub authority: Signer<'info>,

    pub config: Account<'info, Config>,

    #[account(mut, seeds = [b"verifier_set"], bump)]
    pub verifier_set: Account<'info, VerifierSet>,
}

#[derive(Accounts)]
pub struct PostBond<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    /// The set PDA. Sets created before Phase 3A were allocated for bare-
    /// pubkey members; the realloc normalizes every account to the current
    /// layout size on the first join, with the joining member paying any
    /// rent delta (a no-op on already-current sets).
    #[account(
        mut,
        seeds = [b"verifier_set"],
        bump,
        realloc = 8 + VerifierSet::MAX_SIZE,
        realloc::payer = member,
        realloc::zero = false
    )]
    pub verifier_set: Account<'info, VerifierSet>,

    /// The set's canonical bond-vault ATA — validated by address (created
    /// once by the cutover script, like the treasury's), never trusted blind.
    #[account(
        mut,
        constraint = bond_vault.key()
            == anchor_spl::associated_token::get_associated_token_address(
                &verifier_set.key(),
                &usdc_mint.key(),
            ) @ FarmError::TokenAccountInvalid
    )]
    pub bond_vault: Account<'info, TokenAccount>,

    /// The bond mint — every collateral account must agree with it.
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = member_usdc.owner == member.key() @ FarmError::TokenAccountInvalid,
        constraint = member_usdc.mint == usdc_mint.key() @ FarmError::TokenAccountInvalid
    )]
    pub member_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

    /// Referenced by the realloc constraint above: the rent top-up and the
    /// resize CPI both go through the system program.
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveVerifier<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    #[account(mut, seeds = [b"verifier_set"], bump)]
    pub verifier_set: Account<'info, VerifierSet>,

    #[account(
        mut,
        constraint = bond_vault.key()
            == anchor_spl::associated_token::get_associated_token_address(
                &verifier_set.key(),
                &usdc_mint.key(),
            ) @ FarmError::TokenAccountInvalid
    )]
    pub bond_vault: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,

    /// Where the returned bond lands — must be the exiting member's account.
    #[account(
        mut,
        constraint = member_usdc.owner == member.key() @ FarmError::TokenAccountInvalid,
        constraint = member_usdc.mint == usdc_mint.key() @ FarmError::TokenAccountInvalid
    )]
    pub member_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReleaseVerifier<'info> {
    /// Role gate: only `config.admin` may free a member's seat.
    #[account(constraint = authority.key() == config.admin @ FarmError::UnauthorisedAdmin)]
    pub authority: Signer<'info>,

    pub config: Account<'info, Config>,

    #[account(mut, seeds = [b"verifier_set"], bump)]
    pub verifier_set: Account<'info, VerifierSet>,

    #[account(
        mut,
        constraint = bond_vault.key()
            == anchor_spl::associated_token::get_associated_token_address(
                &verifier_set.key(),
                &usdc_mint.key(),
            ) @ FarmError::TokenAccountInvalid
    )]
    pub bond_vault: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,

    /// Where the returned bond lands — the released member's own USDC
    /// account. The mint is pinned here; the handler pins the owner to
    /// `target` before any state moves, so governance cannot redirect it.
    #[account(
        mut,
        constraint = member_usdc.mint == usdc_mint.key() @ FarmError::TokenAccountInvalid
    )]
    pub member_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SlashVerifier<'info> {
    /// Role gate: only `config.admin` may destroy a bond.
    #[account(constraint = authority.key() == config.admin @ FarmError::UnauthorisedAdmin)]
    pub authority: Signer<'info>,

    pub config: Account<'info, Config>,

    #[account(mut, seeds = [b"verifier_set"], bump)]
    pub verifier_set: Account<'info, VerifierSet>,

    /// CHECK: seeds-validated program treasury — the slash destination's
    /// authority (same PDA as `withdraw_treasury`).
    #[account(seeds = [b"treasury"], bump)]
    pub treasury: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = bond_vault.key()
            == anchor_spl::associated_token::get_associated_token_address(
                &verifier_set.key(),
                &usdc_mint.key(),
            ) @ FarmError::TokenAccountInvalid
    )]
    pub bond_vault: Account<'info, TokenAccount>,

    /// The slashed bond moves here: the treasury's canonical USDC ATA.
    #[account(
        mut,
        constraint = treasury_usdc.key()
            == anchor_spl::associated_token::get_associated_token_address(
                &treasury.key(),
                &usdc_mint.key(),
            ) @ FarmError::TokenAccountInvalid
    )]
    pub treasury_usdc: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    /// Pays the tally account's rent on the report's first vote.
    #[account(mut)]
    pub voter: Signer<'info>,

    /// Membership gate: only a bonded seat may vote. Checked before the
    /// tally's `init_if_needed`, so a stranger's failed vote costs nothing.
    #[account(
        seeds = [b"verifier_set"],
        bump,
        constraint = verifier_set.members.iter().any(|m| m.pubkey == voter.key())
            @ FarmError::UnauthorisedVerifier
    )]
    pub verifier_set: Account<'info, VerifierSet>,

    /// The Pending gate is also the tally's close: once a side reaches `k`
    /// the status flips and every later vote fails here.
    #[account(mut, constraint = report.status == ReportStatus::Pending @ FarmError::AlreadyVerified)]
    pub report: Account<'info, ScoutReport>,

    /// Farm must match the report so a finalizing approval bumps
    /// verified_report_count (the old single-verifier behaviour, preserved).
    #[account(mut, constraint = farm.key() == report.farm)]
    pub farm: Account<'info, Farm>,

    #[account(
        init_if_needed,
        payer = voter,
        space = 8 + Tally::MAX_SIZE,
        seeds = [b"tally", report.key().as_ref()],
        bump
    )]
    pub tally: Account<'info, Tally>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RewardReport<'info> {
    /// No signer gate: the handler's Verified-status check is the whole
    /// gate, and the payout's destination and amount are both protocol-pinned.
    #[account(mut)]
    pub report: Account<'info, ScoutReport>,

    /// CHECK: PDA signing authority for the reward vault, no data read
    #[account(seeds = [b"reward_authority"], bump)]
    pub reward_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = reward_vault.owner == reward_authority.key() @ FarmError::RewardVaultInvalid,
        constraint = reward_vault.mint == reward_mint.key() @ FarmError::RewardVaultInvalid
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    /// Reward SPL mint (e.g. SKR on devnet)
    pub reward_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = reporter_token_account.owner == report.reporter @ FarmError::ReporterTokenInvalid,
        constraint = reporter_token_account.mint == reward_mint.key() @ FarmError::ReporterTokenInvalid
    )]
    pub reporter_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ── Layer 2 ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct SubmitHarvestBatch<'info> {
    #[account(mut)]
    pub farmer: Signer<'info>,

    #[account(mut, constraint = farm.owner == farmer.key())]
    pub farm: Account<'info, Farm>,

    #[account(
        init,
        payer = farmer,
        space = 8 + HarvestBatch::MAX_SIZE,
        seeds = [b"batch", farm.key().as_ref(), &farm.batch_count.to_le_bytes()],
        bump
    )]
    pub batch: Account<'info, HarvestBatch>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    pub batch: Account<'info, HarvestBatch>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::MAX_SIZE,
        seeds = [b"escrow", batch.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        init,
        payer = buyer,
        token::mint = usdc_mint,
        token::authority = escrow,
        seeds = [b"escrow_vault", batch.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        
        mut,
        constraint = buyer_usdc.owner == buyer.key() @ FarmError::TokenAccountInvalid,
        constraint = buyer_usdc.mint == usdc_mint.key() @ FarmError::TokenAccountInvalid
    )]
    pub buyer_usdc: Account<'info, TokenAccount>,

    #[account(constraint = usdc_mint.decimals == 6 @ FarmError::TokenAccountInvalid)]
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    pub farmer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.batch.as_ref()],
        bump = escrow.bump,
        constraint = escrow.farmer == farmer.key() @ FarmError::UnauthorisedEscrow
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut, seeds = [b"escrow_vault", escrow.batch.as_ref()], bump)]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = farmer_usdc.owner == escrow.farmer @ FarmError::TokenAccountInvalid,
        constraint = farmer_usdc.mint == escrow_vault.mint @ FarmError::TokenAccountInvalid
    )]
    pub farmer_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    // `mut` because closing the escrow PDAs refunds rent to the buyer.
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        close = buyer,
        seeds = [b"escrow", escrow.batch.as_ref()],
        bump = escrow.bump,
        constraint = escrow.buyer == buyer.key() @ FarmError::UnauthorisedEscrow
    )]
    pub escrow: Account<'info, Escrow>,

    // Closed in the handler via a token-program CPI: only the owner program
    // may move this account's lamports, so Anchor's `close` cannot be used.
    #[account(mut, seeds = [b"escrow_vault", escrow.batch.as_ref()], bump)]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = buyer_usdc.owner == escrow.buyer @ FarmError::TokenAccountInvalid,
        constraint = buyer_usdc.mint == escrow_vault.mint @ FarmError::TokenAccountInvalid
    )]
    pub buyer_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ── Layer 3 ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CreatePolicy<'info> {
    #[account(mut)]
    pub farmer: Signer<'info>,

    #[account(mut, constraint = farm.owner == farmer.key())]
    pub farm: Account<'info, Farm>,

    #[account(
        init,
        payer = farmer,
        space = 8 + Policy::MAX_SIZE,
        seeds = [b"policy", farm.key().as_ref(), &farm.policy_count.to_le_bytes()],
        bump
    )]
    pub policy: Account<'info, Policy>,

    #[account(
        init,
        payer = farmer,
        token::mint = usdc_mint,
        token::authority = policy,
        seeds = [b"insurance_vault", farm.key().as_ref(), &farm.policy_count.to_le_bytes()],
        bump
    )]
    pub insurance_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = farmer_usdc.owner == farmer.key() @ FarmError::TokenAccountInvalid,
        constraint = farmer_usdc.mint == usdc_mint.key() @ FarmError::TokenAccountInvalid
    )]
    pub farmer_usdc: Account<'info, TokenAccount>,

    #[account(constraint = usdc_mint.decimals == 6 @ FarmError::TokenAccountInvalid)]
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Bootstrap the reader rules: one-shot (the PDA's `init` refuses a second
/// call). Seats arrive via `add_oracle`.
#[derive(Accounts)]
pub struct InitOracleSet<'info> {
    /// Role gate: only `config.admin` sets the rules. Also pays the PDA's
    /// rent on init, hence `mut`.
    #[account(mut, constraint = authority.key() == config.admin @ FarmError::UnauthorisedAdmin)]
    pub authority: Signer<'info>,

    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = authority,
        space = 8 + OracleSet::MAX_SIZE,
        seeds = [b"oracle_set"],
        bump
    )]
    pub oracle_set: Account<'info, OracleSet>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManageOracle<'info> {
    /// Role gate: only `config.admin` assigns or revokes reader seats.
    #[account(constraint = authority.key() == config.admin @ FarmError::UnauthorisedAdmin)]
    pub authority: Signer<'info>,

    pub config: Account<'info, Config>,

    #[account(mut, seeds = [b"oracle_set"], bump)]
    pub oracle_set: Account<'info, OracleSet>,
}

#[derive(Accounts)]
#[instruction(season_start: i64)]
pub struct SubmitOracleReading<'info> {
    /// Membership gate: only the admin-managed oracle set may read; also pays
    /// the tally's rent on the season's first reading, hence `mut`.
    #[account(mut)]
    pub member: Signer<'info>,

    #[account(
        seeds = [b"oracle_set"],
        bump,
        constraint = oracle_set.members.contains(&member.key()) @ FarmError::UnauthorisedOracle
    )]
    pub oracle_set: Account<'info, OracleSet>,

    pub farm: Account<'info, Farm>,

    #[account(
        init_if_needed,
        payer = member,
        space = 8 + WeatherOracle::MAX_SIZE,
        seeds = [b"weather", farm.key().as_ref(), &season_start.to_le_bytes()],
        bump
    )]
    pub oracle: Account<'info, WeatherOracle>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season_start: i64, feed: Pubkey)]
pub struct RegisterSwitchboardFeed<'info> {
    /// Role gate: only `config.admin` pins a job's trust root — the same
    /// authority that assigns oracle seats.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(constraint = authority.key() == config.admin @ FarmError::UnauthorisedAdmin)]
    pub config: Account<'info, Config>,

    pub farm: Account<'info, Farm>,

    /// Role-1 shape: the feed must already hold an oracle-set seat, so its
    /// receipt enters the tally as an assigned reader — not a spare voice.
    #[account(
        seeds = [b"oracle_set"],
        bump,
        constraint = oracle_set.members.contains(&feed) @ FarmError::UnauthorisedOracle
    )]
    pub oracle_set: Account<'info, OracleSet>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + SwitchboardFeedBinding::MAX_SIZE,
        seeds = [b"sb_feed", farm.key().as_ref(), &season_start.to_le_bytes(), feed.as_ref()],
        bump
    )]
    pub binding: Account<'info, SwitchboardFeedBinding>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season_start: i64, feed: Pubkey)]
pub struct SubmitSwitchboardReading<'info> {
    /// Permissionless: the receipt's quorum carries the authority; this
    /// signer only exists to pay for a tally the season hasn't created yet.
    #[account(mut)]
    pub relayer: Signer<'info>,

    /// The seat may not be revoked underneath the binding — a receipt from
    /// an unseated feed is no longer a reader's reading.
    #[account(
        seeds = [b"oracle_set"],
        bump,
        constraint = oracle_set.members.contains(&feed) @ FarmError::UnauthorisedOracle
    )]
    pub oracle_set: Account<'info, OracleSet>,

    pub farm: Account<'info, Farm>,

    #[account(
        seeds = [b"sb_feed", farm.key().as_ref(), &season_start.to_le_bytes(), feed.as_ref()],
        bump
    )]
    pub binding: Account<'info, SwitchboardFeedBinding>,

    #[account(
        init_if_needed,
        payer = relayer,
        space = 8 + WeatherOracle::MAX_SIZE,
        seeds = [b"weather", farm.key().as_ref(), &season_start.to_le_bytes()],
        bump
    )]
    pub oracle: Account<'info, WeatherOracle>,

    /// The instructions sysvar — `load_instruction_at_checked` recovers the
    /// ed25519 precompile instructions this transaction already executed,
    /// whose verified signer/message pairs are the receipt. The address pin
    /// is the security boundary: without it a caller could hand us an
    /// instruction list the runtime never ran.
    /// CHECK: read only via `load_instruction_at_checked`/`load_current_index_checked`;
    /// `address = INSTRUCTIONS_SYSVAR` pins it to the real sysvar.
    #[account(address = INSTRUCTIONS_SYSVAR)]
    pub instructions: UncheckedAccount<'info>,

    /// Freshness window: the receipt's signed slothash must still be among
    /// the last 512 slots' hashes. `Sysvar<'info, SlotHashes>` cannot be
    /// used — solana-sysvar refuses in-program deserialization of this
    /// account — so the address is pinned and the bytes are read directly.
    /// CHECK: read only via `try_borrow_data` in `verify_switchboard_receipt`,
    /// which bounds the count/length before scanning; `address =` pins it to
    /// the real sysvar.
    #[account(address = SLOT_HASHES_SYSVAR)]
    pub slot_hashes: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettlePolicy<'info> {
    /// Role gate: only `config.admin` can trigger settlement.
    #[account(constraint = settler.key() == config.admin @ FarmError::UnauthorisedVerifier)]
    pub settler: Signer<'info>,

    /// Governance role — who may trigger settlement; the treasury below is
    /// program-owned, so rotating admin moves settlement but not custody.
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"policy", policy.farm.as_ref(), &policy.index.to_le_bytes()],
        bump = policy.bump
    )]
    pub policy: Account<'info, Policy>,

    #[account(
        mut,
        seeds = [b"insurance_vault", policy.farm.as_ref(), &policy.index.to_le_bytes()],
        bump
    )]
    pub insurance_vault: Account<'info, TokenAccount>,

    pub oracle: Account<'info, WeatherOracle>,

    #[account(
        mut,
        constraint = farmer_usdc.owner == policy.farmer @ FarmError::TokenAccountInvalid,
        constraint = farmer_usdc.mint == insurance_vault.mint @ FarmError::TokenAccountInvalid
    )]
    pub farmer_usdc: Account<'info, TokenAccount>,

    /// Program-owned treasury: refunds sweep to its canonical USDC ATA,
    /// whoever `config.admin` happens to be.
    /// CHECK: the `seeds` constraint re-derives the address from
    /// `[b"treasury"]` under this program, so only the program's own PDA
    /// passes — no state is read from it beyond the address.
    #[account(seeds = [b"treasury"], bump)]
    pub treasury: UncheckedAccount<'info>,

    /// The treasury's canonical USDC ATA — validated by address, so the
    /// sweep can only land in program custody.
    #[account(
        mut,
        constraint = insurer_usdc.key()
            == anchor_spl::associated_token::get_associated_token_address(
                &treasury.key(),
                &insurance_vault.mint,
            ) @ FarmError::TokenAccountInvalid,
        constraint = insurer_usdc.mint == insurance_vault.mint @ FarmError::TokenAccountInvalid
    )]
    pub insurer_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Layer 1 — closing a farm record
#[derive(Accounts)]
pub struct DeleteFarm<'info> {
    #[account(
        mut,
        close = owner,
        seeds = [b"farm", owner.key().as_ref()],
        bump = farm.bump,
        has_one = owner @ FarmError::NotFarmOwner
    )]
    pub farm: Account<'info, Farm>,

    /// The owner receives the rent; the PDA seeds bind this signer to the farm.
    #[account(mut)]
    pub owner: Signer<'info>,
}

/// Layer 3 — farmer revokes an active policy before season end
#[derive(Accounts)]
pub struct RevokePolicy<'info> {
    #[account(mut)]
    pub farmer: Signer<'info>,

    #[account(
        mut,
        close = farmer,
        seeds = [b"policy", policy.farm.as_ref(), &policy.index.to_le_bytes()],
        bump = policy.bump,
        constraint = policy.farmer == farmer.key() @ FarmError::NotPolicyFarmer
    )]
    pub policy: Account<'info, Policy>,

    #[account(
        mut,
        seeds = [b"insurance_vault", policy.farm.as_ref(), &policy.index.to_le_bytes()],
        bump
    )]
    pub insurance_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = farmer_usdc.owner == farmer.key() @ FarmError::TokenAccountInvalid,
        constraint = farmer_usdc.mint == insurance_vault.mint @ FarmError::TokenAccountInvalid
    )]
    pub farmer_usdc: Account<'info, TokenAccount>,

    /// Program-owned treasury: the sweep-back lands in its canonical USDC
    /// ATA — validated by address, the same check as `settle_policy`.
    /// CHECK: the `seeds` constraint re-derives the address from
    /// `[b"treasury"]` under this program, so only the program's own PDA
    /// passes — no state is read from it beyond the address.
    #[account(seeds = [b"treasury"], bump)]
    pub treasury: UncheckedAccount<'info>,

    /// The treasury's canonical USDC ATA.
    #[account(
        mut,
        constraint = insurer_usdc.key()
            == anchor_spl::associated_token::get_associated_token_address(
                &treasury.key(),
                &insurance_vault.mint,
            ) @ FarmError::TokenAccountInvalid,
        constraint = insurer_usdc.mint == insurance_vault.mint @ FarmError::TokenAccountInvalid
    )]
    pub insurer_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    /// Role gate: only `config.admin` may move treasury funds.
    #[account(constraint = authority.key() == config.admin @ FarmError::UnauthorisedAdmin)]
    pub authority: Signer<'info>,

    pub config: Account<'info, Config>,

    /// CHECK: the `seeds` constraint re-derives the address from
    /// `[b"treasury"]` under this program, so only the program's own PDA
    /// passes — no state is read from it beyond the address.
    #[account(seeds = [b"treasury"], bump)]
    pub treasury: UncheckedAccount<'info>,

    /// The treasury's canonical USDC ATA — the only source funds leave from.
    #[account(
        mut,
        constraint = treasury_usdc.key()
            == anchor_spl::associated_token::get_associated_token_address(
                &treasury.key(),
                &destination_usdc.mint,
            ) @ FarmError::TokenAccountInvalid
    )]
    pub treasury_usdc: Account<'info, TokenAccount>,

    /// Withdrawals land in the admin's own USDC account (a vault's, once
    /// `set_roles` points admin at a multisig) — never an arbitrary sink.
    #[account(
        mut,
        constraint = destination_usdc.owner == config.admin @ FarmError::TokenAccountInvalid,
        constraint = destination_usdc.mint == treasury_usdc.mint @ FarmError::TokenAccountInvalid
    )]
    pub destination_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Events
// ─────────────────────────────────────────────────────────────────────────────

// Layer 1
#[event]
pub struct FarmRegistered {
    pub farm: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct FarmDeleted {
    pub farm: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct ScoutReportSubmitted {
    pub farm: Pubkey,
    pub report: Pubkey,
    pub index: u32,
}

#[event]
pub struct ScoutReportVerified {
    pub report: Pubkey,
    pub approved: bool,
    pub verifier: Pubkey,
}

#[event]
pub struct ReportRewarded {
    pub report: Pubkey,
    pub reporter: Pubkey,
    pub amount: u64,
}

// Layer 2
#[event]
pub struct HarvestBatchSubmitted {
    pub farm: Pubkey,
    pub batch: Pubkey,
    pub index: u32,
    pub quantity_kg: u64,
}

#[event]
pub struct EscrowCreated {
    pub escrow: Pubkey,
    pub batch: Pubkey,
    pub buyer: Pubkey,
    pub amount_usdc: u64,
}

#[event]
pub struct EscrowReleased {
    pub escrow: Pubkey,
    pub farmer: Pubkey,
    pub amount_usdc: u64,
}

#[event]
pub struct EscrowCancelled {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub amount_usdc: u64,
}

// Layer 3
#[event]
pub struct PolicyCreated {
    pub policy: Pubkey,
    pub farm: Pubkey,
    pub coverage_usdc: u64,
    pub trigger_threshold_mm: u32,
}

#[event]
pub struct WeatherReadingSubmitted {
    pub oracle: Pubkey,
    pub farm: Pubkey,
    pub total_rainfall_mm: u32,
    /// True when this instruction created the tally (the season's first
    /// reading); false when it added to — or replaced a value within — an
    /// existing one.
    pub created: bool,
}

#[event]
pub struct PolicySettled {
    pub policy: Pubkey,
    pub triggered: bool,
    pub payout_usdc: u64,
    pub rainfall_mm: u32,
}

#[event]
pub struct PolicyRevoked {
    pub policy: Pubkey,
    pub farmer: Pubkey,
    pub premium_refunded_usdc: u64,
}

// Layer 0 (appended — event names hash to discriminators, order is free)
#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub verifier: Pubkey,
    pub oracle: Pubkey,
}

#[event]
pub struct RolesRotated {
    pub admin: Pubkey,
    pub verifier: Pubkey,
    pub oracle: Pubkey,
}

#[event]
pub struct TreasuryWithdrawn {
    pub amount: u64,
    pub destination: Pubkey,
}

// Phase 1 — verifier set & quorum voting
#[event]
pub struct VerifierSetInitialized {
    pub k: u8,
    pub bond_amount: u64,
}

#[event]
pub struct VerifierJoined {
    pub member: Pubkey,
    pub bond: u64,
}

#[event]
pub struct VerifierExited {
    pub member: Pubkey,
    pub bond: u64,
}

#[event]
pub struct VerifierSlashed {
    pub member: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VerifierSetReconfigured {
    pub k: u8,
    pub bond_amount: u64,
}

#[event]
pub struct VerifierReleased {
    pub member: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VoteCast {
    pub report: Pubkey,
    pub voter: Pubkey,
    pub approve: bool,
    pub approvals: u8,
    pub rejections: u8,
}

// Phase 2 — oracle median
#[event]
pub struct OracleSetInitialized {
    pub k: u8,
}

#[event]
pub struct OracleJoined {
    pub member: Pubkey,
}

#[event]
pub struct OracleRemoved {
    pub member: Pubkey,
}

#[event]
pub struct WeatherMedianFinalized {
    pub oracle: Pubkey,
    pub farm: Pubkey,
    pub total_rainfall_mm: u32,
    pub readings: u8,
}

// Layer 3B — Switchboard receipt reading (role-1)
#[event]
pub struct SwitchboardFeedRegistered {
    pub farm: Pubkey,
    pub feed: Pubkey,
    pub feed_hash: [u8; 32],
    pub signers: u8,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum FarmError {
    // Layer 1
    #[msg("Farm name too long (max 64 chars)")]
    NameTooLong,
    #[msg("URI too long (max 128 chars)")]
    UriTooLong,
    #[msg("Label too long (max 32 chars)")]
    LabelTooLong,
    #[msg("Report already verified or rejected")]
    AlreadyVerified,
    #[msg("Report is not verified")]
    NotVerified,

    // Layer 2
    #[msg("Notes too long (max 256 chars)")]
    NotesTooLong,
    #[msg("Quantity must be greater than zero")]
    ZeroQuantity,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Escrow is not in funded state")]
    EscrowNotFunded,
    #[msg("Caller is not authorised for this escrow")]
    UnauthorisedEscrow,
    #[msg("Escrow is locked — cancellation window has passed")]
    EscrowLocked,

    // Layer 3
    #[msg("Season end must be after season start")]
    InvalidSeason,
    #[msg("Policy is not active")]
    PolicyNotActive,
    #[msg("Oracle farm does not match policy farm")]
    OracleFarmMismatch,
    #[msg("Oracle season does not match policy season")]
    OracleSeasonMismatch,
    #[msg("Season has not ended yet")]
    SeasonNotEnded,

    // Access control
    #[msg("Caller is not the authorised verifier/admin")]
    UnauthorisedVerifier,
    #[msg("Caller is not the authorised weather oracle")]
    UnauthorisedOracle,
    #[msg("Reward vault does not belong to the program reward authority")]
    RewardVaultInvalid,
    #[msg("Reporter token account does not match the report recipient or mint")]
    ReporterTokenInvalid,
    #[msg("Token account owner or mint does not match the expected values")]
    TokenAccountInvalid,

    // Appended with the farm/policy lifecycle instructions — appended only,
    // so error codes declared above stay stable.
    #[msg("Caller does not own this farm")]
    NotFarmOwner,
    #[msg("Caller is not the policy farmer")]
    NotPolicyFarmer,
    #[msg("Season has ended — the policy can no longer be revoked")]
    RevocationWindowClosed,
    #[msg("Counter overflow")]
    Overflow,

    // Appended with the config (Layer 0) instructions.
    #[msg("Caller is not the authorised program admin")]
    UnauthorisedAdmin,

    // Appended with the verifier-set (Phase 1) instructions.
    #[msg("Quorum must be between 2 and the verifier-set maximum")]
    InvalidQuorum,
    #[msg("Bond amount must be greater than zero")]
    ZeroBond,
    #[msg("Key is already a bonded verifier")]
    AlreadyVerifier,
    #[msg("The verifier set is full")]
    VerifierSetFull,
    #[msg("Verifier has already voted on this report")]
    AlreadyVoted,

    // Appended with the oracle-set (Phase 2) instructions.
    #[msg("Oracle quorum must be an odd number from 3 to the oracle-set maximum")]
    InvalidMedianQuorum,
    #[msg("Key is already a reader in the oracle set")]
    AlreadyOracle,
    #[msg("The oracle set is full")]
    OracleSetFull,
    #[msg("The season reading is already final")]
    ReadingFinalized,
    #[msg("The season reading has not reached quorum")]
    ReadingNotFinalized,

    // Appended with the Phase 3A governed reconfiguration instructions.
    #[msg("Removal would take the verifier set below its quorum")]
    DropBelowQuorum,

    // Appended with the Switchboard receipt reading (role-1).
    #[msg("The feed registration needs at least three distinct signers")]
    InvalidFeedRegistration,
    #[msg("The Switchboard receipt is malformed or not signed for the bound feed")]
    InvalidSwitchboardReceipt,
    #[msg("The Switchboard receipt is stale: its slothash left the recent window")]
    StaleSwitchboardReceipt,
    #[msg("The Switchboard receipt lacks the pinned enclave quorum for this feed")]
    UnauthorisedSwitchboardSigner,
    #[msg("The signed value is not a non-negative whole 0.1 mm of rainfall")]
    InvalidSwitchboardValue,
}
