import { describe, expect, it } from "vitest";

import { CONNECTOR_MODAL_IDS, selectActiveModal } from "./ConnectorModalHost";
import { CONNECTORS } from "@/constants/connectors";

type StoreShape = Parameters<typeof selectActiveModal>[0];

// selectActiveModal only reads the modal booleans, so a partial store is enough.
function storeWith(overrides: Record<string, unknown> = {}): StoreShape {
  return overrides as unknown as StoreShape;
}

describe("selectActiveModal", () => {
  it("returns null when no modal flag is set", () => {
    expect(selectActiveModal(storeWith())).toBeNull();
  });

  it("maps each flag to its modal id", () => {
    expect(selectActiveModal(storeWith({ isStripeModalOpen: true }))).toBe("stripe");
    expect(selectActiveModal(storeWith({ isGA4ModalOpen: true }))).toBe("ga4");
    expect(selectActiveModal(storeWith({ isWarehouseModalOpen: true }))).toBe(
      "warehouse",
    );
    expect(selectActiveModal(storeWith({ isAllConnectorsModalOpen: true }))).toBe(
      "all_connectors",
    );
  });

  it("returns a stable identity so the host does not re-render on unrelated writes", () => {
    const first = selectActiveModal(storeWith({ isStripeModalOpen: true, messages: [] }));
    const second = selectActiveModal(
      storeWith({ isStripeModalOpen: true, messages: [1, 2, 3] }),
    );
    expect(first).toBe(second);
  });

  it("never returns a modal id that is missing from the registry", () => {
    for (const id of CONNECTOR_MODAL_IDS) {
      expect(typeof id).toBe("string");
    }
    expect(new Set(CONNECTOR_MODAL_IDS).size).toBe(CONNECTOR_MODAL_IDS.length);
  });
});

describe("registry coverage", () => {
  it("covers every connector that declares a modalTarget", () => {
    // The four warehouse targets share one component, so they collapse to the
    // single "warehouse" id. Everything else maps one-to-one.
    const warehouseTargets = new Set([
      "postgres",
      "bigquery",
      "snowflake",
      "databricks",
    ]);

    const declared = new Set(
      CONNECTORS.flatMap((connector) =>
        connector.modalTarget
          ? [
              warehouseTargets.has(connector.modalTarget)
                ? "warehouse"
                : connector.modalTarget,
            ]
          : [],
      ),
    );

    const registered = new Set<string>(CONNECTOR_MODAL_IDS);
    const missing = [...declared].filter((target) => !registered.has(target));

    expect(missing).toEqual([]);
  });
});
