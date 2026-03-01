export const GlassMaterialVariant = {
  Regular: "regular",
} as const;

export async function isGlassSupported(): Promise<boolean> {
  return false;
}

export async function setLiquidGlassEffect(_options: {
  enabled: boolean;
  cornerRadius?: number;
  variant?: string;
}): Promise<void> {
  return;
}
