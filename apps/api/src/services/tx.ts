import type { Db } from '@gg/db';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
