# Solana Universal NFT Program for ZetaChain

![Built with Anchor](https://img.shields.io/badge/Built%20with-Anchor-blueviolet)

This repository contains a Solana smart contract (program) built with the Anchor framework, designed to enable robust cross-chain NFT transfers between the Solana blockchain and the ZetaChain ecosystem.

The program replicates the core functionality of the EVM Universal NFT standard, providing the necessary on-chain logic for Solana to act as a connected chain. It is a direct solution to the requirements outlined in the ZetaChain bounty issue `standard-contracts/issues/72`.

## ✨ Features

The on-chain program provides three core instructions:

1.  **`initialize`**: A secure, one-time instruction to configure the program with the addresses of the authority and the trusted ZetaChain Gateway program.
2.  **`on_zeta_message`**: The inbound instruction. It is called exclusively by the trusted ZetaChain Gateway to mint a new Metaplex-standard NFT on Solana, representing an asset transferred from another chain.
3.  **`send_nft_outbound`**: The outbound instruction. It allows a user on Solana to send their NFT to another chain by transferring it into a secure program-controlled custody account and signaling an event for the ZetaChain network to process.

## 🔗 Cross-Chain Flow Demonstration

This program serves as the Solana-side endpoint for ZetaChain's cross-chain messaging protocol. The interaction is managed by the ZetaChain Gateway contract deployed on Solana.

### Inbound Flow (ZetaChain → Solana)

This flow corresponds to the **"mint incoming NFTs"** requirement.

```
[Other Chain e.g., BNB] ---> [ZetaChain] ---> [ZetaChain Solana Gateway] --(CPI)--> [Our Program's on_zeta_message function]
```


1.  A user on a connected EVM chain (like BNB) calls the `transfer` function on the connected NFT contract.
2.  ZetaChain's network observes this event and constructs a cross-chain message.
3.  ZetaChain's TSS validators sign a transaction that calls the official ZetaChain Gateway program on Solana.
4.  The Gateway program, acting as the signer, makes a Cross-Program Invocation (CPI) to our `universal-nft` program, specifically calling the `on_zeta_message` instruction.
5.  Our program verifies that the caller (`gateway`) is the trusted gateway address stored in its configuration.
6.  Upon successful verification, our program parses the message and mints a new Metaplex NFT to the specified recipient's wallet.

### Outbound Flow (Solana → ZetaChain)

This flow corresponds to the **"send NFT to other connected chains"** requirement.

```
[User on Solana] --(Calls send_nft_outbound)--> [Our Program] --(Locks NFT & emits event for ZetaChain)--> [ZetaChain Network] ---> [Destination Chain]
```

1.  A user holding a universal NFT on Solana calls the `send_nft_outbound` instruction in our program.
2.  The instruction verifies that the user owns the NFT.
3.  The NFT is transferred from the user's wallet into a secure, program-controlled Associated Token Account (a custody vault). This effectively locks the NFT on Solana, preventing double-spending.
4.  The instruction then (conceptually) makes a CPI to the ZetaChain Gateway's `deposit_and_call` function, passing a message containing the destination chain ID, destination recipient address, and NFT metadata.
5.  ZetaChain's network observes this event and initiates the minting of the corresponding NFT on the destination chain.

## 🛠️ Setup and Installation

Follow these instructions to set up the project, run tests, and reproduce the results.

### Prerequisites

Ensure you have the following software installed:
*   **Rust** & **Cargo**: [https://www.rust-lang.org/tools/install](https://www.rust-lang.org/tools/install)
*   **Solana Tool Suite**: [https://docs.solana.com/cli/install](https://docs.solana.com/cli/install)
*   **Node.js & Yarn**: We recommend using `nvm`. Node v20+ is required.
*   **Anchor Framework**: `avm install latest && avm use latest`

### Installation

1.  **Clone the repository:**
    ```bash
    git clone [Your Repository URL]
    cd universal-nft
    ```

2.  **Install testing dependencies:**
    ```bash
    yarn install
    ```

3.  **A Note on Dependencies:** This project uses a `[patch]` section in the root `Cargo.toml` to override and unify versions of core Solana and tooling libraries (`solana-program`, `spl-token`, `proc-macro2`, etc.). This is **critical** to prevent version conflicts between Anchor, Metaplex, and the SPL. The first build will be very long as it compiles these libraries from source.

## 🚀 Building and Testing

### Build the Program

Compile the on-chain Rust program to produce the deployable binary and the IDL (Interface Description Language).

```bash
anchor build
```

The first build can take 15-20 minutes due to the patched dependencies. Subsequent builds will be much faster.

### Run the Tests

The project includes a comprehensive test suite in the `tests/` directory that verifies all on-chain functionality.

```bash
anchor test
```
🔗 Integration with ZetaChain localnet.sh

This Solana program is designed to be the missing piece in the bounty's localnet.sh script. To integrate it, the following steps would be taken within that script's flow:
```
    Build and Deploy the Solana Program:
    After starting the ZetaChain localnet, you would build and deploy this Anchor project.
    code Bash

    IGNORE_WHEN_COPYING_START
    IGNORE_WHEN_COPYING_END

        
    # In the universal-nft directory
    anchor build
    anchor deploy --provider localnet

      

    You would capture the deployed Program ID.

    Update the ZetaChain Universal NFT Contract:
    A new function would be needed in the Hardhat tasks to call setConnectedContract on the ZetaChain universal NFT contract, providing it with the Solana program's ID and the chain ID for Solana.

    Update the localnet.sh script:
    The script would be modified to include the deployment and linking steps for Solana. The final transfer sequence would be: ZetaChain → Ethereum → BNB → Solana → ZetaChain.

A conceptual update to localnet.sh would look like this:```bash
