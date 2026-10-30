/** A File from base64 bytes, as the native Capacitor plugins hand them back to the WebView. Client-safe. */
export function base64ToFile(base64: string, mimeType: string, name: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mimeType });
}
