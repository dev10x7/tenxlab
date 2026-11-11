import type { RuntimeTier } from '@tenxlab/contracts';

/**
 * Routes a lab request to a runtime tier.
 *
 * The lesson may declare a tier explicitly (an instructor knows a kernel module
 * needs a microVM). When it does not, we infer one from the exercise's declared
 * requirements, then from the exercise slug as a last resort. The router is
 * pure and deterministic so its decisions are reproducible in tests and logs.
 */

export interface TierRequirements {
  /** Needs its own kernel (eBPF, kernel modules, sysctl). */
  needsKernel?: boolean;
  /** Needs a full Kubernetes control plane. */
  needsCluster?: boolean;
  /** Estimated working set in MB, if known. */
  memoryMb?: number;
}

export interface TierRoutingInput {
  /** Tier declared on the lesson, if any. */
  declaredTier?: string | null;
  /** Structured requirements from the exercise manifest. */
  requirements?: TierRequirements | null;
  /** Exercise slug, used only as a fallback signal. */
  exerciseSlug?: string | null;
}

export interface TierDecision {
  tier: RuntimeTier;
  reason: string;
}

const CLUSTER_HINTS = [
  'kubernetes',
  'k8s',
  'helm',
  'kubectl',
  'operator',
  'crd',
  'namespace',
  'deployment',
  'statefulset',
  'vcluster',
];

const KERNEL_HINTS = ['ebpf', 'kernel', 'sysctl', 'module', 'bpftrace', 'perf'];

const VALID_TIERS: RuntimeTier[] = [
  'tier_1_microvm',
  'tier_2_container',
  'tier_3_vcluster',
];

export function routeTier(input: TierRoutingInput): TierDecision {
  if (input.declaredTier) {
    if ((VALID_TIERS as string[]).includes(input.declaredTier)) {
      return {
        tier: input.declaredTier as RuntimeTier,
        reason: 'lesson declares an explicit runtime tier',
      };
    }
    return {
      tier: 'tier_2_container',
      reason: `unknown declared tier "${input.declaredTier}"; fell back to container`,
    };
  }

  const req = input.requirements ?? {};
  if (req.needsCluster) {
    return { tier: 'tier_3_vcluster', reason: 'exercise requires a Kubernetes control plane' };
  }
  if (req.needsKernel) {
    return { tier: 'tier_1_microvm', reason: 'exercise requires its own kernel' };
  }

  const slug = (input.exerciseSlug ?? '').toLowerCase();
  if (slug && CLUSTER_HINTS.some((h) => slug.includes(h))) {
    return { tier: 'tier_3_vcluster', reason: `slug "${slug}" indicates cluster work` };
  }
  if (slug && KERNEL_HINTS.some((h) => slug.includes(h))) {
    return { tier: 'tier_1_microvm', reason: `slug "${slug}" indicates kernel-level work` };
  }

  return { tier: 'tier_2_container', reason: 'default tier for general exercises' };
}
