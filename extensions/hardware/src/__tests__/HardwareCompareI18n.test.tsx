import { beforeEach, describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import type { CompareDataModule } from "@/shared/compare/types";
import HardwareCompare from "@extension/components/HardwareCompare";
import { useHardwareCompareStore } from "@extension/store";

interface GpuModel {
  id: string;
  model: string;
  brand: string;
}

const gpuModule: CompareDataModule<GpuModel> = {
  data: [
    { id: "rtx-5090", model: "GeForce RTX 5090", brand: "NVIDIA" },
    { id: "rx-9070", model: "Radeon RX 9070", brand: "AMD" },
  ],
  specRows: [],
  numericKeys: [],
  inverseKeys: [],
  i18nPrefix: "gpuCompare",
  filterGroups: [{ key: "brand", label: "gpuCompare.brand" }],
};

describe("HardwareCompare shared GPU filter labels", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useHardwareCompareStore.setState({
      selectedIdsByScope: {},
      filtersByScope: { gpuCompare: { brand: "missing" } },
    });
  });

  it("uses shared translations for controls while keeping GPU-specific model labels", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <HardwareCompare module={gpuModule} />
      </I18nextProvider>,
    );

    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
    expect(screen.getByText("0 found")).toBeInTheDocument();
    expect(screen.getByText("Clear selected")).toBeInTheDocument();
    expect(screen.getByText("Select models to compare")).toBeInTheDocument();
    expect(screen.getAllByText("Select models above to compare")).toHaveLength(
      2,
    );
    expect(
      screen.getByTitle("Pinned open, click for auto-expand"),
    ).toBeInTheDocument();
  });
});
