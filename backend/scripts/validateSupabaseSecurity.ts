import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type TableSecurity = {
  name: string;
  createFiles: string[];
  grants: {
    anonSelect: boolean;
    authenticatedCrud: boolean;
    serviceRoleCrud: boolean;
  };
  rlsEnabled: boolean;
  policies: Set<"select" | "insert" | "update" | "delete">;
};

const repoRoot = path.resolve(process.cwd());
const migrationsDir = path.join(repoRoot, "supabase", "migrations");

function listSqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .map((entry) => path.join(dir, entry))
    .filter((file) => statSync(file).isFile() && file.endsWith(".sql"))
    .sort();
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

function ensureTable(map: Map<string, TableSecurity>, name: string): TableSecurity {
  const existing = map.get(name);
  if (existing) {
    return existing;
  }
  const created: TableSecurity = {
    name,
    createFiles: [],
    grants: {
      anonSelect: false,
      authenticatedCrud: false,
      serviceRoleCrud: false,
    },
    rlsEnabled: false,
    policies: new Set(),
  };
  map.set(name, created);
  return created;
}

function collectTables(files: string[]): {
  tables: Map<string, TableSecurity>;
  publicFunctions: string[];
} {
  const tables = new Map<string, TableSecurity>();
  const publicFunctions = new Set<string>();

  for (const file of files) {
    const sql = readFileSync(file, "utf8");

    for (const match of sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-zA-Z0-9_]+)/gi)) {
      const table = ensureTable(tables, match[1]);
      table.createFiles.push(path.relative(repoRoot, file));
    }

    for (const match of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-zA-Z0-9_]+)/gi)) {
      publicFunctions.add(match[1]);
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

      match = statement.match(
        /grant select, insert, update, delete on table public\.([a-zA-Z0-9_]+) to authenticated/,
      );
      if (match) {
        ensureTable(tables, match[1]).grants.authenticatedCrud = true;
      }

      match = statement.match(
        /grant select, insert, update, delete on table public\.([a-zA-Z0-9_]+) to service_role/,
      );
      if (match) {
        ensureTable(tables, match[1]).grants.serviceRoleCrud = true;
      }

      match = statement.match(/alter table public\.([a-zA-Z0-9_]+) enable row level security/);
      if (match) {
        ensureTable(tables, match[1]).rlsEnabled = true;
      }

      match = statement.match(/create policy [a-zA-Z0-9_]+ on public\.([a-zA-Z0-9_]+) for (select|insert|update|delete)/);
      if (match) {
        ensureTable(tables, match[1]).policies.add(match[2] as "select" | "insert" | "update" | "delete");
      }
    }
  }

  return { tables, publicFunctions: [...publicFunctions].sort() };
}

function main() {
  const files = listSqlFiles(migrationsDir);
  const { tables, publicFunctions } = collectTables(files);

  const findings: string[] = [];
  const manualReview: string[] = [];

  for (const table of [...tables.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!table.grants.anonSelect) {
      findings.push(`${table.name}: missing "grant select ... to anon"`);
    }
    if (!table.grants.authenticatedCrud) {
      findings.push(`${table.name}: missing authenticated CRUD grant`);
    }
    if (!table.grants.serviceRoleCrud) {
      findings.push(`${table.name}: missing service_role CRUD grant`);
    }
    if (!table.rlsEnabled) {
      findings.push(`${table.name}: missing "alter table ... enable row level security"`);
    }
    if (!table.policies.has("select")) {
      findings.push(`${table.name}: missing SELECT policy`);
    }
    if (table.grants.authenticatedCrud) {
      if (!table.policies.has("insert")) {
        findings.push(`${table.name}: authenticated grant present but INSERT policy missing`);
      }
      if (!table.policies.has("update")) {
        findings.push(`${table.name}: authenticated grant present but UPDATE policy missing`);
      }
      if (!table.policies.has("delete")) {
        findings.push(`${table.name}: authenticated grant present but DELETE policy missing`);
      }
    }
  }

  if (publicFunctions.length > 0) {
    manualReview.push(
      `Public functions detected and not auto-validated for EXECUTE grants: ${publicFunctions.join(", ")}`,
    );
  }

  const summaryLines = [
    "Supabase Data API security validation",
    `Migrations scanned: ${files.length}`,
    `Public tables found: ${tables.size}`,
    "",
    "Table inventory:",
    ...[...tables.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (table) =>
          `- ${table.name}: grants[anon=${table.grants.anonSelect ? "yes" : "no"}, auth=${table.grants.authenticatedCrud ? "yes" : "no"}, service=${table.grants.serviceRoleCrud ? "yes" : "no"}], rls=${table.rlsEnabled ? "yes" : "no"}, policies=${[...table.policies].sort().join(",") || "none"}`,
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
