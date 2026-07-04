/**
 * Runs the shared GameStore contract against MemoryGameStore. The same contract
 * runs against the Table Storage adapter under Azurite in api/ (tableStore.test),
 * so a behavioral drift between the backends surfaces as a failing test.
 */
import { describe } from "vitest";
import { makeMemoryStore } from "./memoryStore";
import { runStoreContract } from "./storeContract";

describe("GameStore contract — MemoryGameStore", () => {
  runStoreContract(() => makeMemoryStore());
});
