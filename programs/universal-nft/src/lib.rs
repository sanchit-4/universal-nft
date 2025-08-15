use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{mint_to, transfer, Mint, MintTo, Token, TokenAccount, Transfer},
};
use mpl_token_metadata::{
    instruction::CreateMetadataAccountsV3,
    state::{CollectionDetails, DataV2},
};

declare_id!("5nqfDd7MiQM9FZJN26ZFumS1uKxhsvpeCjtTWFdbv5BR");

#[program]
pub mod universal_nft {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, gateway_address: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = *ctx.accounts.authority.key;
        config.gateway_address = gateway_address;
        config.bump = ctx.bumps.config;
        msg!("Program initialized!");
        msg!("Authority: {}", config.authority);
        msg!("Gateway: {}", config.gateway_address);
        Ok(())
    }

    pub fn on_zeta_message(ctx: Context<OnZetaMessage>, _message: Vec<u8>) -> Result<()> {
        // 1. SECURITY CHECK: Verify the caller is the legitimate ZetaChain Gateway
        require_keys_eq!(
            ctx.accounts.gateway.key(),
            ctx.accounts.config.gateway_address,
            MyError::InvalidGateway
        );

        // 2. PARSE THE MESSAGE
        // For a real implementation, parse recipient, name, symbol, uri from `_message`
        let name = "Zeta NFT".to_string();
        let symbol = "ZNFT".to_string();
        let uri = "https://zetachain.com/nft.json".to_string();

        // 3. MINT THE NFT
        msg!("Creating metadata account...");
        let seeds = &[&b"config"[..], &[ctx.accounts.config.bump]];
        let signer_seeds = &[&seeds[..]];

        create_metadata_accounts_v3(
            CpiContext::new(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: ctx.accounts.metadata_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.config.to_account_info(),
                    payer: ctx.accounts.gateway.to_account_info(),
                    update_authority: ctx.accounts.config.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            DataV2 {
                name,
                symbol,
                uri,
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            },
            true, // is_mutable
            true, // update_authority_is_signer
            Some(CollectionDetails::V1 { size: 0 }),
        )?;

        msg!("Minting one token to recipient...");
        mint_to(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.token_account.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            1, // amount
        )?;

        Ok(())
    }

    pub fn send_nft_outbound(
        ctx: Context<SendNftOutbound>,
        destination_chain_id: u64,
        destination_address: Vec<u8>,
    ) -> Result<()> {
        // 1. SECURITY CHECKS
        require_gt!(ctx.accounts.sender_token_account.amount, 0, MyError::NoTokens);
        require_keys_eq!(
            ctx.accounts.gateway_program.key(),
            ctx.accounts.config.gateway_address,
            MyError::InvalidGateway
        );

        // 2. TRANSFER NFT TO CUSTODY
        msg!("Transferring NFT to program custody...");
        transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.sender_token_account.to_account_info(),
                    to: ctx.accounts.custody_token_account.to_account_info(),
                    authority: ctx.accounts.sender.to_account_info(),
                },
            ),
            1, // amount
        )?;

        // 3. (SIMULATED) CPI TO ZETACHAIN GATEWAY
        msg!(
            "Simulating CPI to ZetaChain Gateway (Address: {})",
            ctx.accounts.gateway_program.key()
        );
        msg!("Destination Chain ID: {}", destination_chain_id);
        msg!("Destination Address: {:?}", destination_address);

        Ok(())
    }
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub gateway_address: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 1,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OnZetaMessage<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub gateway: Signer<'info>,
    /// CHECK: This is the account for the NFT's metadata, which we will create.
    #[account(
        mut,
        seeds = [
            b"metadata",
            token_metadata_program.key().as_ref(),
            mint.key().as_ref()
        ],
        bump,
        seeds::program = token_metadata_program.key()
    )]
    pub metadata_account: AccountInfo<'info>,
    #[account(
        init,
        payer = gateway,
        mint::decimals = 0,
        mint::authority = config,
        mint::freeze_authority = config
    )]
    pub mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = gateway,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub token_account: Account<'info, TokenAccount>,
    /// CHECK: The recipient of the NFT.
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    // Required Solana Programs
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    /// CHECK: The token metadata program.
    pub token_metadata_program: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
}

// Add this line right above your struct
#[derive(Accounts)]
pub struct SendNftOutbound<'info> {
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub sender: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = sender,
    )]
    pub sender_token_account: Account<'info, TokenAccount>,
    pub nft_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = sender,
        associated_token::mint = nft_mint,
        associated_token::authority = config,
    )]
    pub custody_token_account: Account<'info, TokenAccount>,
    /// CHECK: The ZetaChain Gateway Program.
    pub gateway_program: AccountInfo<'info>,
    // Required Solana Programs
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[error_code]
pub enum MyError {
    #[msg("The provided gateway address does not match the one in config.")]
    InvalidGateway,
    #[msg("The sender's token account has no tokens to send.")]
    NoTokens,
}