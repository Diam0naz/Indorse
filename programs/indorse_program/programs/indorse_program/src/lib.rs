use anchor_lang::prelude::*;
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

/// Reward paid from the reward vault for one quorum-approved report.
/// Protocol-fixed: `reward_report` is permissionless, so neither the amount
/// nor the destination may be caller-chosen. Changing the schedule is a
/// program upgrade, not a parameter.
pub const REPORT_REWARD: u64 = 1_000_000;

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

    /// Join the set by posting the bond: the member's own USDC account pays
    /// into the program-held bond vault, so the seat — not the protocol —
    /// carries the collateral. Bonds leave only two ways: back to the member
    /// via `remove_verifier`, or to the treasury via a governed slash.
    pub fn post_bond(ctx: Context<PostBond>) -> Result<()> {
        let member = ctx.accounts.member.key();
        let set = &mut ctx.accounts.verifier_set;
        require!(!set.members.contains(&member), FarmError::AlreadyVerifier);
        require!(set.members.len() < MAX_VERIFIERS, FarmError::VerifierSetFull);
        let bond = set.bond_amount;
        set.members.push(member);

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
    /// Votes already cast on open tallies keep counting.
    pub fn remove_verifier(ctx: Context<RemoveVerifier>) -> Result<()> {
        let member = ctx.accounts.member.key();
        let set = &mut ctx.accounts.verifier_set;
        let position = set
            .members
            .iter()
            .position(|m| *m == member)
            .ok_or(FarmError::UnauthorisedVerifier)?;
        set.members.remove(position);
        let bond = set.bond_amount;

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
            bond,
        )?;

        emit!(VerifierExited { member, bond });
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
            .position(|m| *m == target)
            .ok_or(FarmError::UnauthorisedVerifier)?;
        set.members.remove(position);
        let bond = set.bond_amount;

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
            bond,
        )?;

        emit!(VerifierSlashed { member: target, amount: bond });
        Ok(())
    }

    /// Cast one quorum vote on a pending report — any bonded member, one
    /// vote each. The first side to reach `verifier_set.k` finalises the
    /// report (an approval also bumps the farm's verified count); from then
    /// on the report's `Pending` gate closes the tally, so late votes fail
    /// honestly instead of flipping a result.
    pub fn cast_vote(ctx: Context<CastVote>, approve: bool) -> Result<()> {
        let voter = ctx.accounts.voter.key();
        let tally = &mut ctx.accounts.tally;
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

        let k = ctx.accounts.verifier_set.k;
        if approvals >= k || rejections >= k {
            let approved = approvals >= k;
            let report = &mut ctx.accounts.report;
            report.status = if approved {
                ReportStatus::Verified
            } else {
                ReportStatus::Rejected
            };
            report.verifier = voter;

            if approved {
                ctx.accounts.farm.verified_report_count = ctx
                    .accounts
                    .farm
                    .verified_report_count
                    .checked_add(1)
                    .ok_or(FarmError::Overflow)?;
            }

            emit!(ScoutReportVerified {
                report: report.key(),
                approved,
                verifier: voter,
            });
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
    pub fn submit_weather_reading(
        ctx: Context<SubmitWeatherReading>,
        season_start: i64,
        total_rainfall_mm: u32, // Accumulated rainfall for the season (mm × 10)
        reading_timestamp: i64,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.oracle;
        // `init_if_needed` serves both the first reading and later corrections.
        // A freshly initialised account is zeroed, so an unset authority is the
        // tell that this call created the account rather than updating it.
        let created = oracle.authority == Pubkey::default();

        oracle.farm = ctx.accounts.farm.key();
        oracle.authority = ctx.accounts.authority.key();
        oracle.season_start = season_start;
        oracle.total_rainfall_mm = total_rainfall_mm;
        oracle.reading_timestamp = reading_timestamp;
        oracle.bump = ctx.bumps.oracle;

        emit!(WeatherReadingSubmitted {
            oracle: oracle.key(),
            farm: oracle.farm,
            total_rainfall_mm,
            created,
        });
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
    /// Posts weather readings.
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
    /// USDC (atomic units) each member posts to join — fixed at init.
    pub bond_amount: u64,
    /// Bonded members; the MAX_VERIFIERS bound keeps the account fixed-size.
    pub members: Vec<Pubkey>,
    pub bump: u8,
}
impl VerifierSet {
    pub const MAX_SIZE: usize = 1 + 8 + 4 + (32 * MAX_VERIFIERS) + 1;
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

/// Layer 3 — Weather oracle reading (posted by authorised oracle keypair)
#[account]
pub struct WeatherOracle {
    pub farm: Pubkey,
    pub authority: Pubkey,
    pub season_start: i64,
    pub total_rainfall_mm: u32, // Accumulated mm × 10 for precision
    pub reading_timestamp: i64,
    pub bump: u8,
}
impl WeatherOracle {
    pub const MAX_SIZE: usize = 32 + 32 + 8 + 4 + 8 + 1;
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

#[derive(Accounts)]
pub struct PostBond<'info> {
    #[account(mut)]
    pub member: Signer<'info>,

    #[account(mut, seeds = [b"verifier_set"], bump)]
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
        constraint = verifier_set.members.contains(&voter.key()) @ FarmError::UnauthorisedVerifier
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

#[derive(Accounts)]
#[instruction(season_start: i64)]
pub struct SubmitWeatherReading<'info> {
    /// Role gate: only `config.oracle` may act as the weather oracle.
    #[account(
        mut,
        constraint = authority.key() == config.oracle @ FarmError::UnauthorisedOracle
    )]
    pub authority: Signer<'info>,

    /// The role lives here — rotating it is `set_roles`, not a redeploy.
    pub config: Account<'info, Config>,

    pub farm: Account<'info, Farm>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + WeatherOracle::MAX_SIZE,
        seeds = [b"weather", farm.key().as_ref(), &season_start.to_le_bytes()],
        bump
    )]
    pub oracle: Account<'info, WeatherOracle>,

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
    /// True when this instruction created the oracle account (the first
    /// reading for the farm/season); false when it overwrote an existing one.
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
pub struct VoteCast {
    pub report: Pubkey,
    pub voter: Pubkey,
    pub approve: bool,
    pub approvals: u8,
    pub rejections: u8,
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
}
