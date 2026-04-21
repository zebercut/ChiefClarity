/**
 * SQL parameter value compatible with @libsql/client execute().
 * Mirrors @libsql/core InValue so we don't depend on the internal module path.
 */
export type SqlValue = string | number | null | bigint | ArrayBuffer | Uint8Array | boolean;
