"use client";

import { createContext, useContext } from "react";

export type MatrixMode = "executive" | "analyst";

export const MatrixModeContext = createContext<MatrixMode>("executive");

export function useMatrixMode(): MatrixMode {
  return useContext(MatrixModeContext);
}
