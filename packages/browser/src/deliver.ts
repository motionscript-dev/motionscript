/**
 * Hand an export's bytes back, or download them through an `<a download>`.
 * Headless callers capture the bytes and write the file themselves.
 */
export function deliver(
    bytes: Uint8Array,
    options: { returnBytes: boolean; filename: string; mimeType: string },
): Uint8Array | undefined {
    if (options.returnBytes) return bytes;

    // Every encoder here builds its Uint8Array over a whole, plain ArrayBuffer, so
    // the cast is sound — TS only balks because the generic parameter admits a
    // SharedArrayBuffer, which a BlobPart may not be.
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: options.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = options.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return undefined;
}
