use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht");

/// Hackathon authority — verifier, reward caller and weather oracle.
/// For production this would be a multisig or a dedicated oracle program.
pub const ADMIN: Pubkey = anchor_lang::pubkey!("AXUTwBhtwbgAJGAZYKHXAJgSo4dMC29XrnbP91BPcYg8");

// ─────────────────────────────────────────────────────────────────────────────
//  Program
// ─────────────────────────────────────────────────────────────────────────────

#[program]
pub mod indorse_program {
    use super::*;

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

        farm.report_count += 1;

        emit!(ScoutReportSubmitted {
            farm: farm.key(),
            report: report.key(),
            index: report.index,
        });
        Ok(())
    }

    /// Approve or reject a pending scout report.
    pub fn verify_scout_report(ctx: Context<VerifyScoutReport>, approved: bool) -> Result<()> {
        let report = &mut ctx.accounts.report;
        require!(
            report.status == ReportStatus::Pending,
            FarmError::AlreadyVerified
        );

        report.status = if approved {
            ReportStatus::Verified
        } else {
            ReportStatus::Rejected
        };
        report.verifier = ctx.accounts.verifier.key();

        // Keep a tally of verified reports on the farm for insurance premiums
        if approved {
            ctx.accounts.farm.verified_report_count += 1;
        }

        emit!(ScoutReportVerified {
            report: report.key(),
            approved,
            verifier: report.verifier,
        });
        Ok(())
    }

    /// Transfer SKR tokens from the reward vault to the reporter.
    pub fn reward_report(ctx: Context<RewardReport>, amount: u64) -> Result<()> {
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
            amount,
        )?;

        // Mark as paid so the vault cannot be drained twice for one report
        report.status = ReportStatus::Rewarded;

        emit!(ReportRewarded {
            report: report.key(),
            reporter: report.reporter,
            amount,
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

        farm.batch_count += 1;

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
        require!(
            ctx.accounts.farmer.key() == escrow.farmer,
            FarmError::UnauthorisedEscrow
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
        require!(
            ctx.accounts.buyer.key() == escrow.buyer,
            FarmError::UnauthorisedEscrow
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
        ctx.accounts.farm.policy_count += 1;

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
}

// ─────────────────────────────────────────────────────────────────────────────
//  Accounts
// ─────────────────────────────────────────────────────────────────────────────

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
    pub verifier: Pubkey,
    pub timestamp: i64,
    pub bump: u8,
}
impl ScoutReport {
    pub const MAX_SIZE: usize = 32 + 32 + 4 + 32 + (4 + 128) + 8 + 8 + (4 + 32) + 1 + 32 + 8 + 1;
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

// ── Layer 1 ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(name: String)]
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

#[derive(Accounts)]
pub struct VerifyScoutReport<'info> {
    /// Hackathon gate: only the admin can verify reports.
    #[account(constraint = verifier.key() == ADMIN @ FarmError::UnauthorisedVerifier)]
    pub verifier: Signer<'info>,

    #[account(mut)]
    pub report: Account<'info, ScoutReport>,

    /// Farm must match the report so we can increment verified_report_count
    #[account(mut, constraint = farm.key() == report.farm)]
    pub farm: Account<'info, Farm>,
}

#[derive(Accounts)]
pub struct RewardReport<'info> {
    /// Hackathon gate: only the admin can pay out rewards.
    #[account(constraint = authority.key() == ADMIN @ FarmError::UnauthorisedVerifier)]
    pub authority: Signer<'info>,

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

    #[account(mut, seeds = [b"escrow", escrow.batch.as_ref()], bump = escrow.bump)]
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
        bump = escrow.bump
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
#[instruction(crop: String, coverage_usdc: u64, premium_usdc: u64,
              trigger_threshold_mm: u32, season_start: i64)]
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
    /// Hackathon gate: only the admin can act as the weather oracle.
    #[account(
        mut,
        constraint = authority.key() == ADMIN @ FarmError::UnauthorisedOracle
    )]
    pub authority: Signer<'info>,

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
    /// Hackathon gate: only the admin can trigger settlement.
    #[account(constraint = settler.key() == ADMIN @ FarmError::UnauthorisedVerifier)]
    pub settler: Signer<'info>,

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

    #[account(
        mut,
        constraint = insurer_usdc.owner == ADMIN @ FarmError::TokenAccountInvalid,
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

    #[account(
        mut,
        constraint = insurer_usdc.owner == ADMIN @ FarmError::TokenAccountInvalid,
        constraint = insurer_usdc.mint == insurance_vault.mint @ FarmError::TokenAccountInvalid
    )]
    pub insurer_usdc: Account<'info, TokenAccount>,

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
}
