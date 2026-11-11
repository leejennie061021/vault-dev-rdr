# Неделя 10 — CPI и вывод из Vault

## Требование
При выводе пользовательские share-токены сжигаются через `token::burn`, а vault возвращает SPL-токены через `token::transfer` с подписью PDA (`CpiContext::new_with_signer`).

## Где находится реализация
- `programs/simple_vault/src/lib.rs`: `pub fn withdraw(...)` и `pub struct Withdraw`.
- `tests/vault.ts`: существующие проверки вывода плюс тест `week 10: вывод 10 shares через Burn + PDA Transfer`.

## Как работает
1. Проверяем, что `shares_amount > 0`, что vault не пустой и `tokens_out > 0`.
2. Рассчитываем `tokens_out = shares_amount * total_tokens / total_shares` с проверкой переполнения.
3. CPI `token::burn` сжигает shares пользователя с его подписью.
4. CPI `token::transfer` возвращает SPL-токены с авторизацией `vault_state` PDA через seeds `['vault', token_mint, bump]`.
5. Обновляем `total_tokens` и `total_shares` с проверкой арифметики.

## Демонстрация
Тесты из `tests/vault.ts` сначала вносят токены, затем выводят их. Дополнительный тест выводит **10 shares** и проверяет:
- share-баланс пользователя стал на 10 меньше;
- совокупная эмиссия shares уменьшилась на 10;
- SPL-баланс пользователя вырос на 10;
- SPL-баланс vault уменьшился на 10;
- `total_tokens` и `total_shares` уменьшились до 40.

> Для тестов требуется настроенная среда Anchor 0.31.1, кошелёк, SOL на комиссии, развёрнутая в Devnet программа по ID из `lib.rs`, и актуальный `target/idl` / `target/types`. Сценарий проверяет настоящие CPI лишь после успешного запуска on-chain.

## GitHub
Загрузите изменённый `tests/vault.ts` и новый `WEEK10.md`. Контракт `lib.rs` менять **не нужно** — `withdraw` уже реализован в вашем исходном ZIP.
