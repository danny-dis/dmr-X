export { PolicyService, policyService, type PolicyRule, type Policy } from './policy.service.js';

export {
  RBACPolicyEngine,
  getRBACEngine,
  resetRBACEngine,
  parsePolicy,
  PREDEFINED_POLICIES,
  type RBACConfig,
  type Effect,
  type Principal,
  type Action,
  type Resource,
  type AuthorizationRequest,
  type AuthorizationResponse,
  type Condition,
} from './rbac.js';
