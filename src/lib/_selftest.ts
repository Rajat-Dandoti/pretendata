// Runs every module's _selfCheck under `npm test`. Keeps the checks out of the
// browser bundle and actually executes them (they never ran before).
import { _selfCheck as validators } from './validators';
import { _selfCheck as manifest } from './manifest';
import { _selfCheck as share } from './share';
import { _selfCheck as zip } from './zip';
import { _selfCheck as generate } from './generate';
import { _selfCheck as frameworks } from './frameworks';
import { _selfCheck as reference } from './reference';
import { _selfCheck as nesting } from './nesting';

[validators, manifest, share, zip, generate, frameworks, reference, nesting].forEach((f) => f());
console.log('all self-checks passed');
