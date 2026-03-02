import { isMobilePlatform } from "@utils/platformPaths";
import { useDebugLog } from "@/features/debug/hooks/useDebugLog";
import { useAppSettingsController } from "@app/hooks/useAppSettingsController";
import { useCodeCssVars } from "@app/hooks/useCodeCssVars";
import { useLiquidGlassEffect } from "@app/hooks/useLiquidGlassEffect";

export function useAppBootstrap() {
  const appSettingsState = useAppSettingsController();
  useCodeCssVars(appSettingsState.appSettings);

  const debugState = useDebugLog();

  const shouldReduceTransparency =
    appSettingsState.reduceTransparency || isMobilePlatform();

  useLiquidGlassEffect({
    reduceTransparency: shouldReduceTransparency,
    onDebug: debugState.addDebugEntry,
  });

  return {
    ...appSettingsState,
    ...debugState,
    shouldReduceTransparency,
  };
}
