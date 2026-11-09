/** A request the server refuses, with the status it answers. */
export class HttpError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'HttpError';
    }
}
