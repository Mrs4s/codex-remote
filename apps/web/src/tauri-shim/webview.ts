const webviewHandle: any = {
  async setZoom(_value: number): Promise<void> {
    return;
  },
};

export function getCurrentWebview(): any {
  return webviewHandle;
}
