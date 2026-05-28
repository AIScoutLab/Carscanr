import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type TableClass = "public_read" | "user_owned" | "server_owned_user_read" | "internal";
type PolicyAction = "select" | "insert" | "update" | "delete";
type RoleName = "anon" | "authenticated" | "service_role" | "public";

type TableSecurity = {
  name: string;
  className: TableClass;
  createFiles: string[];
  grants: {
    anonSelect: boolean;
    authenticatedSelect: boolean;
    authenticatedCrud: boolean;
    serviceRoleCrud: boolean;
  };
  revokes: {
    anonAll: boolean;
    authenticatedAll: boolean;
  };
  rlsEnabled: boolean;
  policies: Set<PolicyAction>;
};

type FunctionSecurity = {
  name: string;
  signatures: Set<string>;
  files: Set<string>;
  securityDefiner: boolean;
  searchPathPinned: boolean;
  grantedRoles: Set<RoleName>;
  revokedFromPublic: boolean;
};

const repoRoot = path.resolve(process.cwd());
const migrationsDir = path.join(repoRoot, "supabase", "migrations");

const publicReadTables = new Set(["vehicles", "canonical_vehicles"]);
const userOwnedTables = new Set([
  "scans",
  "garage_items",
  "vision_debug_logs",
]);
const serverOwnedUserReadTables = new Set([
  "subscriptions",
  "usage_counters",
  "user_unlock_balances",
  "user_vehicle_unlocks",
]);
const internalTables = new Set([
  "valuations",
  "listing_results",
  "provider_specs_cache",
  "provider_values_cache",
  "provider_listings_cache",
  "provider_vehicle_specs_cache",
  "provider_vehicle_values_cache",
  "provider_vehicle_listings_cache",
  "provider_api_usage_logs",
  "revenuecat_events",
  "cached_analysis",
  "image_cache",
  "vehicle_scan_popularity",
  "vehicle_global_trending",
]);

const serviceRoleOnlyFunctions = new Set([
  "grant_user_vehicle_unlock",
  "increment_cached_analysis_hit",
  "increment_canonical_vehicle_popularity",
  "increment_image_cache_hit",
  "increment_provider_vehicle_listings_cache_hit",
  "increment_provider_vehicle_specs_cache_hit",
  "increment_provider_vehicle_values_cache_hit",
  "promote_canonical_vehicle",
]);
const triggerOnlyFunctions = new Set(["set_updated_at"]);

function listSqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .map((entry) => path.join(dir, entry))
    .filter((file) => statSync(file).isFile() && file.endsWith(".sql"))
    .sort();
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

function classifyTable(name: string): TableClass {
  if (publicReadTables.has(name)) {
    return "public_read";
  }
  if (userOwnedTables.has(name)) {
    return "user_owned";
  }
  if (serverOwnedUserReadTables.has(name)) {
    return "server_owned_user_read";
  }
  if (internalTables.has(name)) {
    return "internal";
  }
  return "internal";
}

function ensureTable(map: Map<string, TableSecurity>, name: string): TableSecurity {
  const existing = map.get(name);
  if (existing) {
    return existing;
  }
  const created: TableSecurity = {
    name,
    className: classifyTable(name),
    createFiles: [],
    grants: {
      anonSelect: false,
      authenticatedSelect: false,
      authenticatedCrud: false,
      serviceRoleCrud: false,
    },
    revokes: {
      anonAll: false,
      authenticatedAll: false,
    },
    rlsEnabled: false,
    policies: new Set(),
  };
  map.set(name, created);
  return created;
}

function ensureFunction(map: Map<string, FunctionSecurity>, name: string): FunctionSecurity {
  const existing = map.get(name);
  if (existing) {
    return existing;
  }
  const created: FunctionSecurity = {
    name,
    signatures: new Set(),
    files: new Set(),
    securityDefiner: false,
    searchPathPinned: false,
    grantedRoles: new Set(),
    revokedFromPublic: false,
  };
  map.set(name, created);
  return created;
}

function collectTablesAndFunctions(files: string[]): {
  tables: Map<string, TableSecurity>;
  functions: Map<string, FunctionSecurity>;
} {
  const tables = new Map<string, TableSecurity>();
  const functions = new Map<string, FunctionSecurity>();

  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    const relativeFile = path.relative(repoRoot, file);

    for (const match of sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-zA-Z0-9_]+)/gi)) {
      const table = ensureTable(tables, match[1]);
      table.createFiles.push(relativeFile);
    }

    for (const match of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*returns/gi)) {
      const fn = ensureFunction(functions, match[1]);
      fn.signatures.add(match[2].replace(/\s+/g, " ").trim().toLowerCase());
      fn.files.add(relativeFile);
    }

    const normalizedSql = normalizeWhitespace(sql);
    for (const match of normalizedSql.matchAll(/create or replace function public\.([a-zA-Z0-9_]+)\s*\((.*?)\)\s*returns\s+[\s\S]*?language\s+[a-z0-9_]+\s+([\s\S]*?)\$\$/g)) {
      const fn = ensureFunction(functions, match[1]);
      const headerAndBody = match[0];
      if (headerAndBody.includes("security definer")) {
        fn.securityDefiner = true;
      }
      if (headerAndBody.includes("set search_path = public, pg_temp")) {
        fn.searchPathPinned = true;
      }
    }

    const statements = sql
      .split(/;/g)
      .map((statement) => normalizeWhitespace(statement))
      .filter(Boolean);

    for (const statement of statements) {
      let match = statement.match(/grant select on table public\.([a-zA-Z0-9_]+) to anon/);
      if (match) {
        ensureTable(tables, match[1]).grants.anonSelect = true;
      }

      match = statement.match(/grant select on table public\.([a-zA-Z0-9_]+) to authenticated/);
      if (match) {
        ensureTable(tables, match[1]).grants.authenticatedSelect = true;
      }

      match = statement.match(
        /grant select, insert, update, delete on table public\.([a-zA-Z0-9_]+) to authenticated/,
      );
      if (match) {
        const table = ensureTable(tables, match[1]);
        table.grants.authenticatedCrud = true;
        table.grants.authenticatedSelect = true;
      }

      match = statement.match(
        /grant select, insert, update, delete on table public\.([a-zA-Z0-9_]+) to service_role/,
      );
      if (match) {
        ensureTable(tables, match[1]).grants.serviceRoleCrud = true;
      }

      match = statement.match(/revoke all on table public\.([a-zA-Z0-9_]+) from ([a-z_, ]+)/);
      if (match) {
        const table = ensureTable(tables, match[1]);
        const roles = match[2].split(",").map((role) => role.trim());
        if (roles.includes("anon")) {
          table.revokes.anonAll = true;
          table.grants.anonSelect = false;
        }
        if (roles.includes("authenticated")) {
          table.revokes.authenticatedAll = true;
          table.grants.authenticatedSelect = false;
          table.grants.authenticatedCrud = false;
        }
        if (roles.includes("service_role")) {
          table.grants.serviceRoleCrud = false;
        }
      }

      match = statement.match(/alter table public\.([a-zA-Z0-9_]+) enable row level security/);
      if (match) {
        ensureTable(tables, match[1]).rlsEnabled = true;
      }

      match = statement.match(/create policy [a-zA-Z0-9_]+ on public\.([a-zA-Z0-9_]+) for (select|insert|update|delete)/);
      if (match) {
        ensureTable(tables, match[1]).policies.add(match[2] as PolicyAction);
      }

      match = statement.match(/revoke execute on function public\.([a-zA-Z0-9_]+)\(.*\) from ([a-z_, ]+)/);
      if (match) {
        const fn = ensureFunction(functions, match[1]);
        const roles = match[2].split(",").map((role) => role.trim());
        if (roles.includes("public")) {
          fn.revokedFromPublic = true;
        }
      }

      match = statement.match(/grant execute on function public\.([a-zA-Z0-9_]+)\(.*\) to ([a-z_]+)/);
      if (match) {
        ensureFunction(functions, match[1]).grantedRoles.add(match[2] as RoleName);
      }
    }
  }

  return { tables, functions };
}

function main() {
  const files = listSqlFiles(migrationsDir);
  const { tables, functions } = collectTablesAndFunctions(files);

  const findings: string[] = [];
  const manualReview: string[] = [];

  for (const table of [...tables.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!table.rlsEnabled) {
      findings.push(`${table.name}: missing "alter table ... enable row level security"`);
    }
    if (!table.grants.serviceRoleCrud) {
      findings.push(`${table.name}: missing service_role CRUD grant`);
    }

    if (table.className === "public_read") {
      if (!table.grants.anonSelect) {
        findings.push(`${table.name}: public_read table missing anon SELECT grant`);
      }
      if (!table.grants.authenticatedSelect) {
        findings.push(`${table.name}: public_read table missing authenticated SELECT grant`);
      }
      if (!table.policies.has("select")) {
        findings.push(`${table.name}: public_read table missing SELECT policy`);
      }
    }

    if (table.className === "user_owned") {
      if (table.grants.anonSelect) {
        findings.push(`${table.name}: user_owned table should not grant anon SELECT`);
      }
      if (!table.revokes.anonAll) {
        findings.push(`${table.name}: user_owned table missing anon revoke-all statement`);
      }
      if (!table.grants.authenticatedCrud) {
        findings.push(`${table.name}: user_owned table missing authenticated CRUD grant`);
      }
      for (const action of ["select", "insert", "update", "delete"] as PolicyAction[]) {
        if (!table.policies.has(action)) {
          findings.push(`${table.name}: user_owned table missing ${action.toUpperCase()} policy`);
        }
      }
    }

    if (table.className === "server_owned_user_read") {
      if (table.grants.anonSelect) {
        findings.push(`${table.name}: server_owned_user_read table should not grant anon SELECT`);
      }
      if (!table.revokes.anonAll) {
        findings.push(`${table.name}: server_owned_user_read table missing anon revoke-all statement`);
      }
      if (!table.revokes.authenticatedAll) {
        findings.push(`${table.name}: server_owned_user_read table missing authenticated revoke-all statement`);
      }
      if (!table.grants.authenticatedSelect) {
        findings.push(`${table.name}: server_owned_user_read table missing authenticated SELECT grant`);
      }
      if (table.grants.authenticatedCrud) {
        findings.push(`${table.name}: server_owned_user_read table must not grant authenticated INSERT/UPDATE/DELETE`);
      }
      if (!table.policies.has("select")) {
        findings.push(`${table.name}: server_owned_user_read table missing SELECT policy`);
      }
    }

    if (table.className === "internal") {
      if (table.grants.anonSelect) {
        findings.push(`${table.name}: internal table must not grant anon SELECT`);
      }
      if (table.grants.authenticatedCrud || table.grants.authenticatedSelect) {
        findings.push(`${table.name}: internal table must not grant authenticated privileges`);
      }
      if (!table.revokes.anonAll) {
        findings.push(`${table.name}: internal table missing anon revoke-all statement`);
      }
      if (!table.revokes.authenticatedAll) {
        findings.push(`${table.name}: internal table missing authenticated revoke-all statement`);
      }
    }
  }

  for (const fn of [...functions.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const isTriggerOnly = triggerOnlyFunctions.has(fn.name);
    const isServiceRoleOnly = serviceRoleOnlyFunctions.has(fn.name);

    if (!isTriggerOnly && !isServiceRoleOnly) {
      manualReview.push(`${fn.name}: function is not in the validator allowlist`);
      continue;
    }

    if (!fn.revokedFromPublic) {
      findings.push(`${fn.name}: missing "revoke execute ... from public"`);
    }

    if (fn.securityDefiner && !fn.searchPathPinned) {
      findings.push(`${fn.name}: SECURITY DEFINER function missing pinned search_path`);
    }

    if (isTriggerOnly) {
      if (fn.grantedRoles.size > 0) {
        findings.push(`${fn.name}: trigger-only function should not grant EXECUTE to anon/authenticated/service_role`);
      }
      continue;
    }

    if (!fn.grantedRoles.has("service_role")) {
      findings.push(`${fn.name}: missing service_role EXECUTE grant`);
    }
    for (const role of fn.grantedRoles) {
      if (role !== "service_role") {
        findings.push(`${fn.name}: unexpected EXECUTE grant to ${role}`);
      }
    }
  }

  const summaryLines = [
    "Supabase Data API security validation",
    `Migrations scanned: ${files.length}`,
    `Public tables found: ${tables.size}`,
    `Public functions found: ${functions.size}`,
    "",
    "Table inventory:",
    ...[...tables.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (table) =>
          `- ${table.name} [${table.className}]: grants[anon_select=${table.grants.anonSelect ? "yes" : "no"}, auth_select=${table.grants.authenticatedSelect ? "yes" : "no"}, auth_crud=${table.grants.authenticatedCrud ? "yes" : "no"}, service_crud=${table.grants.serviceRoleCrud ? "yes" : "no"}], revokes[anon=${table.revokes.anonAll ? "yes" : "no"}, auth=${table.revokes.authenticatedAll ? "yes" : "no"}], rls=${table.rlsEnabled ? "yes" : "no"}, policies=${[...table.policies].sort().join(",") || "none"}`,
      ),
    "",
    "Function inventory:",
    ...[...functions.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (fn) =>
          `- ${fn.name}: roles=${[...fn.grantedRoles].sort().join(",") || "none"}, security_definer=${fn.securityDefiner ? "yes" : "no"}, search_path_pinned=${fn.searchPathPinned ? "yes" : "no"}, revoked_from_public=${fn.revokedFromPublic ? "yes" : "no"}`,
      ),
  ];

  console.log(summaryLines.join("\n"));

  if (manualReview.length > 0) {
    console.log("\nManual review:");
    for (const item of manualReview) {
      console.log(`- ${item}`);
    }
  }

  if (findings.length > 0) {
    console.error("\nSecurity findings:");
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nNo blocking Supabase Data API security findings.");
}

main();
