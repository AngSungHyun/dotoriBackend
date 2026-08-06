declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId?: string;
        guestSessionId?: string;
      };
    }
  }
}

export {};
