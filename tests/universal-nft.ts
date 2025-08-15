import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { UniversalNft } from "../target/types/universal_nft";
import { assert } from "chai";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Metaplex } from "@metaplex-foundation/js";

describe("universal-nft", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.UniversalNft as Program<UniversalNft>;
  const authority = provider.wallet.publicKey;

  // We need a consistent gateway address for both tests.
  // In the first test, we initialize with it. In the second, we use it as a signer.
  const gatewayKeypair = anchor.web3.Keypair.generate();

  it("Is initialized!", async () => {
    const [configPda, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    const tx = await program.methods
      .initialize(gatewayKeypair.publicKey) // Use the consistent gateway public key
      .accounts({
        config: configPda,
        authority: authority,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Initialize transaction signature", tx);
    const configAccount = await program.account.config.fetch(configPda);
    assert.ok(configAccount.authority.equals(authority));
    assert.ok(configAccount.gatewayAddress.equals(gatewayKeypair.publicKey));
  });

  it("Mints an inbound NFT from a gateway message", async () => {
    // We also need a recipient for the NFT.
    const recipient = anchor.web3.Keypair.generate();

    // The Gateway needs to pay for account creation, so we airdrop it some SOL.
    await provider.connection.requestAirdrop(
      gatewayKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    const mintKeypair = anchor.web3.Keypair.generate();
    const recipientAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      recipient.publicKey
    );

    const metaplex = Metaplex.make(provider.connection);
    const metadataPda = metaplex.nfts().pdas().metadata({
        mint: mintKeypair.publicKey
    });

    const message = Buffer.from([]);

    const tx = await program.methods
      .onZetaMessage(message)
      .accounts({
        config: configPda,
        gateway: gatewayKeypair.publicKey,
        metadataAccount: metadataPda,
        mint: mintKeypair.publicKey,
        tokenAccount: recipientAta,
        recipient: recipient.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        tokenMetadataProgram: new anchor.web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"), // Metaplex Program ID
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([gatewayKeypair, mintKeypair])
      .rpc();

    console.log("onZetaMessage transaction signature", tx);
    const tokenAccountInfo = await provider.connection.getParsedAccountInfo(recipientAta);
    const tokenAmount = (tokenAccountInfo.value.data as any).parsed.info.tokenAmount.uiAmount;
    assert.strictEqual(tokenAmount, 1, "NFT was not minted to the recipient's token account");
    console.log(`Recipient ${recipient.publicKey.toBase58()} now holds 1 NFT.`);
  });

  it("Sends an NFT outbound, locking it in custody", async () => {
    // =====================================================================
    // STEP 1: SETUP - Mint an NFT so we have one to send.
    // This part is very similar to the previous test.
    // =====================================================================
    const user = anchor.web3.Keypair.generate(); // This user will own the NFT
    await provider.connection.requestAirdrop(user.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for airdrop

    const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    const mintKeypair = anchor.web3.Keypair.generate();
    const userAta = getAssociatedTokenAddressSync(mintKeypair.publicKey, user.publicKey);
    const metaplex = Metaplex.make(provider.connection);
    const metadataPda = metaplex.nfts().pdas().metadata({ mint: mintKeypair.publicKey });

    // Mint the NFT by calling the `onZetaMessage` function as the gateway
    await program.methods
      .onZetaMessage(Buffer.from([]))
      .accounts({
        config: configPda,
        gateway: gatewayKeypair.publicKey,
        metadataAccount: metadataPda,
        mint: mintKeypair.publicKey,
        tokenAccount: userAta,
        recipient: user.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        tokenMetadataProgram: new anchor.web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([gatewayKeypair, mintKeypair])
      .rpc();
    
    console.log("Setup complete: NFT has been minted to the user's account.");

    // =====================================================================
    // STEP 2: TEST - Call the `sendNftOutbound` instruction
    // =====================================================================
    const custodyAta = getAssociatedTokenAddressSync(mintKeypair.publicKey, configPda, true);
    
    // The destination address for another chain is just a byte array.
    const destinationAddress = Buffer.from("0xRecipientOnAnotherChain");
    const destinationChainId = new anchor.BN(5); // 5 for Goerli Testnet

    const tx = await program.methods
      .sendNftOutbound(destinationChainId, destinationAddress)
      .accounts({
        config: configPda,
        sender: user.publicKey,
        senderTokenAccount: userAta,
        nftMint: mintKeypair.publicKey,
        custodyTokenAccount: custodyAta,
        gatewayProgram: gatewayKeypair.publicKey, // We reuse the gateway keypair as the gateway address
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      })
      .signers([user]) // The user is the one signing to send their NFT.
      .rpc();

    console.log("sendNftOutbound transaction signature", tx);

    // =====================================================================
    // STEP 3: VERIFY - Check the token account balances
    // =====================================================================
    // The user's token account should now be empty (or closed).
    const userAccountInfo = await provider.connection.getAccountInfo(userAta);
    assert.isNull(userAccountInfo, "User's token account should be closed after sending");

    // The program's custody account should now hold the NFT.
    const custodyAccountInfo = await provider.connection.getParsedAccountInfo(custodyAta);
    const custodyAmount = (custodyAccountInfo.value.data as any).parsed.info.tokenAmount.uiAmount;
    assert.strictEqual(custodyAmount, 1, "NFT was not transferred to the custody account");

    console.log("Verification complete: NFT is now locked in program custody.");
  });
  
});