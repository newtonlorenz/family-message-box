import { getConfig } from "./config.js";
import { openDatabase, migrate, seedDevice } from "./db.js";

const config = getConfig();
const db = openDatabase(config.databasePath);
migrate(db);
if (config.seedDevelopmentDevice) {
  seedDevice(db, "family-box-01", config.developmentDeviceCredential);
}
db.close();
console.log(`Migrations complete: ${config.databasePath}`);
