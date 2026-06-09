interface ImportMeta {
  env: {
    DEV: boolean;
    MODE?: string;
  };
  glob<T = unknown>(
    pattern: string,
    options: { eager: true; import: 'default' },
  ): Record<string, T>;
}
