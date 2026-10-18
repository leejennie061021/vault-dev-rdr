/**
 * Тесты для Simple Vault на devnet
 *
 * Сценарий:
 *   1. Admin создаёт vault (initialize_vault)
 *   2. Пользователи A и B создают свои карточки (create_user_card)
 *   3. Повторное создание карточки A падает
 *   4. created_at записывается в карточку
 *   5. Админ ставит vault на паузу -> create_user_card падает
 *   6. Не-админ не может ставить паузу
 *   7. close_user_card закрывает карточку и возвращает ренту владельцу
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { createMint } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { assert } from "chai";
import { SimpleVault } from "../target/types/simple_vault";

// Переводим SOL от admin → pubkey (обходит rate limit devnet airdrop)
async function fundFromAdmin(
  provider: anchor.AnchorProvider,
  admin: Keypair,
  pubkey: PublicKey,
  lamports = 0.05 * LAMPORTS_PER_SOL
) {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: pubkey, lamports })
  );
  await provider.sendAndConfirm(tx, [admin]);
}

describe("simple_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SimpleVault as Program<SimpleVault>;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const userA = Keypair.generate();
  const userB = Keypair.generate();
  const userC = Keypair.generate();

  let tokenMint: PublicKey;
  let vaultStatePDA: PublicKey;
  let vaultTokenAccountPDA: PublicKey;
  let shareMintPDA: PublicKey;

  const cardPda = (user: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePDA.toBuffer(), user.toBuffer()],
      program.programId
    )[0];

  before(async () => {
    await fundFromAdmin(provider, admin, userA.publicKey);
    await fundFromAdmin(provider, admin, userB.publicKey);
    await fundFromAdmin(provider, admin, userC.publicKey);

    tokenMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);

    [vaultStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId
    );
    [vaultTokenAccountPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens"), tokenMint.toBuffer()],
      program.programId
    );
    [shareMintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), tokenMint.toBuffer()],
      program.programId
    );
  });

  it("initialize_vault: vault создан", async () => {
    await program.methods
      .initializeVault()
      .accounts({
        vaultState: vaultStatePDA,
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        tokenMint,
        admin: admin.publicKey,
      } as any)
      .rpc();

    const vault = await program.account.vaultState.fetch(vaultStatePDA);
    assert.equal(vault.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(vault.tokenMint.toBase58(), tokenMint.toBase58());
    assert.equal(vault.shareMint.toBase58(), shareMintPDA.toBase58());
    assert.isFalse(vault.paused, "новый vault не на паузе");
  });

  it("create_user_card: у каждого пользователя своя карточка", async () => {
    for (const user of [userA, userB]) {
      const userCard = cardPda(user.publicKey);
      await program.methods
        .createUserCard()
        .accounts({ vaultState: vaultStatePDA, userCard, user: user.publicKey } as any)
        .signers([user])
        .rpc();

      const card = await program.account.userCard.fetch(userCard);
      assert.equal(card.owner.toBase58(), user.publicKey.toBase58());
      assert.equal(card.vault.toBase58(), vaultStatePDA.toBase58());
      assert.isAbove(card.createdAt.toNumber(), 0, "created_at должен быть заполнен");
    }
    assert.notEqual(cardPda(userA.publicKey).toBase58(), cardPda(userB.publicKey).toBase58());
  });

  it("create_user_card: вторая карточка для того же пользователя — ошибка", async () => {
    let failed = false;
    try {
      await program.methods
        .createUserCard()
        .accounts({
          vaultState: vaultStatePDA,
          userCard: cardPda(userA.publicKey),
          user: userA.publicKey,
        } as any)
        .signers([userA])
        .rpc();
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "повторная карточка должна быть отклонена");
  });

  it("set_paused: не-админ не может поставить паузу", async () => {
    let failed = false;
    try {
      await program.methods
        .setPaused(true)
        .accounts({ vaultState: vaultStatePDA, admin: userA.publicKey } as any)
        .signers([userA])
        .rpc();
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "пауза от не-админа должна быть отклонена");
  });

  it("paused: на паузе карточку создать нельзя", async () => {
    await program.methods
      .setPaused(true)
      .accounts({ vaultState: vaultStatePDA, admin: admin.publicKey } as any)
      .rpc();
    assert.isTrue((await program.account.vaultState.fetch(vaultStatePDA)).paused);

    let failed = false;
    try {
      await program.methods
        .createUserCard()
        .accounts({
          vaultState: vaultStatePDA,
          userCard: cardPda(userC.publicKey),
          user: userC.publicKey,
        } as any)
        .signers([userC])
        .rpc();
    } catch (e: any) {
      failed = true;
      assert.include(String(e), "VaultPaused");
    }
    assert.isTrue(failed, "создание на паузе должно быть отклонено");
  });

  it("paused: после снятия с паузы карточка создаётся", async () => {
    await program.methods
      .setPaused(false)
      .accounts({ vaultState: vaultStatePDA, admin: admin.publicKey } as any)
      .rpc();

    const userCard = cardPda(userC.publicKey);
    await program.methods
      .createUserCard()
      .accounts({ vaultState: vaultStatePDA, userCard, user: userC.publicKey } as any)
      .signers([userC])
      .rpc();
    const card = await program.account.userCard.fetch(userCard);
    assert.equal(card.owner.toBase58(), userC.publicKey.toBase58());
  });

  it("close_user_card: карточка закрыта, рента возвращена владельцу", async () => {
    const userCard = cardPda(userA.publicKey);
    const cardLamports = await provider.connection.getBalance(userCard);
    assert.isAbove(cardLamports, 0);
    const before = await provider.connection.getBalance(userA.publicKey);

    await program.methods
      .closeUserCard()
      .accounts({ vaultState: vaultStatePDA, userCard, owner: userA.publicKey } as any)
      .signers([userA])
      .rpc();

    assert.isNull(await provider.connection.getAccountInfo(userCard), "аккаунт должен быть закрыт");
    const after = await provider.connection.getBalance(userA.publicKey);
    // рента вернулась (минус комиссия за транзакцию, она < 0.001 SOL)
    assert.isAbove(after, before + cardLamports - 0.001 * LAMPORTS_PER_SOL);
  });

  it("close_user_card: чужую карточку закрыть нельзя", async () => {
    let failed = false;
    try {
      await program.methods
        .closeUserCard()
        .accounts({
          vaultState: vaultStatePDA,
          userCard: cardPda(userB.publicKey),
          owner: userA.publicKey,
        } as any)
        .signers([userA])
        .rpc();
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "закрыть чужую карточку нельзя");
  });
});
