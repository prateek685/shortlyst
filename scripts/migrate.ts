import { AppDataSource } from "../src/store/data-source";

async function main() {
  await AppDataSource.initialize();
  const applied = await AppDataSource.runMigrations();
  console.log(
    applied.length
      ? `Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(", ")}`
      : "No pending migrations.",
  );
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
