/* Explicit historical dataset for regressions that predate the current roster.
   Production never reactivates retired preview personnel. Only these tests do. */
import { DemoModel as ProductionModel } from './core.js';
export { TODAY, EVIDENCE_LIMITS, ensureStorePackageExamples } from './core.js';
export class DemoModel extends ProductionModel {
  constructor(options = {}) {
    super(options);
    if (this._usesPreviewSeed) {
      this.state.therapists = this.state.therapists.filter(row => row.legacy).map(row => ({ ...row, active: true }));
      this.state.storeManagers = this.state.storeManagers.filter(row => row.legacy).map(row => ({ ...row, active: true }));
    }
  }
}
