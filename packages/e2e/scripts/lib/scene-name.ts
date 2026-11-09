/** A scene's display name: its id, PascalCased. `--scenes` accepts it as well as the id. */
export function pascalCase(id: string): string {
    const pascal = id
        .split(/[-_.\s]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
    return pascal || 'Scene';
}
