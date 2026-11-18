import { migrationUrl } from './env';
import { runMigrations } from '../migrate';

await runMigrations(migrationUrl());
console.log('Migrations applied.');
