interface ImportMeta {
  glob<T = unknown>(
    pattern: string,
    options: { eager: true; import: 'default' },
  ): Record<string, T>;
}
