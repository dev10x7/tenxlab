import type {
  BatchRepository,
  DepartmentRepository,
  MembershipRepository,
  TenantRepository,
  UserRepository,
} from '../common/ports';

/** A department with its batch count, as the admin console renders it. */
export interface DepartmentView {
  id: string;
  name: string;
  batchCount: number;
  createdAt: string;
}

/** The tenant's org view: its identity, its departments, and its headcounts. */
export interface OrganizationView {
  tenant: {
    id: string;
    name: string;
    domain: string;
    plan: string;
    status: string;
    maxConcurrentLabs: number;
    monthlyBudgetCents: number;
    maxStorageGb: number;
  };
  departments: DepartmentView[];
  members: { total: number; students: number; instructors: number; admins: number };
  batchCount: number;
}

export interface OrgDeps {
  tenants: TenantRepository;
  departments: DepartmentRepository;
  batches: BatchRepository;
  memberships: MembershipRepository;
  users: UserRepository;
}

/**
 * The Organizations surface (parity §2.2): the admin console's view of a
 * tenant — its departments, its roster headcounts, and its batch count. Reads
 * are scoped to the caller's tenant, so an admin never sees another college's
 * structure.
 */
export class OrgService {
  constructor(private readonly deps: OrgDeps) {}

  /** The tenant's structure, or null when the tenant does not exist. */
  async view(tenantId: string): Promise<OrganizationView | null> {
    const tenant = await this.deps.tenants.findById(tenantId);
    if (!tenant) return null;

    const [departments, batches, memberships] = await Promise.all([
      this.deps.departments.listByTenant(tenantId),
      this.deps.batches.listByTenant(tenantId),
      this.deps.memberships.listByTenant(tenantId),
    ]);

    const departmentViews: DepartmentView[] = departments.map((dept) => ({
      id: dept.id,
      name: dept.name,
      batchCount: batches.filter((b) => b.departmentId === dept.id).length,
      createdAt: dept.createdAt.toISOString(),
    }));

    const counts = { total: 0, students: 0, instructors: 0, admins: 0 };
    for (const membership of memberships) {
      if (membership.status !== 'active') continue;
      counts.total += 1;
      if (membership.role === 'student') counts.students += 1;
      else if (membership.role === 'instructor') counts.instructors += 1;
      else if (membership.role === 'admin') counts.admins += 1;
    }

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        domain: tenant.domain,
        plan: tenant.plan,
        status: tenant.status,
        maxConcurrentLabs: tenant.maxConcurrentLabs,
        monthlyBudgetCents: tenant.monthlyBudgetCents,
        maxStorageGb: tenant.maxStorageGb ?? 0,
      },
      departments: departmentViews,
      members: counts,
      batchCount: batches.length,
    };
  }

  /** Create a department in the caller's tenant. */
  async createDepartment(
    tenantId: string,
    name: string,
  ): Promise<
    | { ok: true; department: DepartmentView }
    | { ok: false; reason: 'name_required' | 'duplicate' }
  > {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, reason: 'name_required' };

    const existing = await this.deps.departments.listByTenant(tenantId);
    if (existing.some((d) => d.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, reason: 'duplicate' };
    }

    const row = await this.deps.departments.create({ tenantId, name: trimmed });
    return {
      ok: true,
      department: {
        id: row.id,
        name: row.name,
        batchCount: 0,
        createdAt: row.createdAt.toISOString(),
      },
    };
  }

  /** Delete a department the tenant owns. */
  async removeDepartment(tenantId: string, id: string): Promise<boolean> {
    const row = await this.deps.departments.findById(id);
    if (!row || row.tenantId !== tenantId) return false;
    await this.deps.departments.delete(id);
    return true;
  }
}
