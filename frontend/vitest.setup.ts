import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without globals, so React Testing Library's auto-cleanup must be registered explicitly.
afterEach(() => cleanup());
