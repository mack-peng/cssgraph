export interface ShimmerProgress {
  onProgress: (progress: { phase: string; current: number; total: number; currentFile?: string }) => void;
  stop: () => Promise<void>;
}

export function createShimmerProgress(): ShimmerProgress {
  return {
    onProgress: () => {},
    stop: async () => {},
  };
}
