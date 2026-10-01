import { describe, expect, test } from "bun:test";
import type { ProviderIdentity } from "../contract/index.ts";
import {
	buildNativeRegistry,
	type NativeAnalyzerRegistration,
	requiredForScoring,
	scoringCatalogMetricIds,
} from "./registry.ts";

/** A valid native identity for tests. */
const identity = (id: string): ProviderIdentity => ({
	kind: "native",
	id,
	toolVersion: "0.2.1",
	adapterVersion: "0.2.1",
	mode: "test",
	options: {},
});

/** A minimal valid registration, overridable per test. */
const entry = (
	id: string,
	overrides: Partial<NativeAnalyzerRegistration> = {},
): NativeAnalyzerRegistration => ({
	identity: identity(id),
	capabilities: [id.replace("trellis.", "")],
	metrics: [],
	requires: [],
	...overrides,
});

describe("buildNativeRegistry", () => {
	test("registers analyzers addressable by id in sorted order", () => {
		const registry = buildNativeRegistry([entry("unslop.b"), entry("unslop.a")]);
		expect(registry.analyzers.map((analyzer) => analyzer.identity.id)).toEqual([
			"unslop.a",
			"unslop.b",
		]);
		expect(registry.has("unslop.a")).toBe(true);
		expect(registry.get("unslop.a")?.identity.id).toBe("unslop.a");
		expect(registry.has("unslop.ghost")).toBe(false);
		expect(registry.get("unslop.ghost")).toBeUndefined();
	});

	test("orders prerequisites first with id-ascending ties", () => {
		const registry = buildNativeRegistry([
			entry("unslop.cycles", { requires: ["unslop.graph"] }),
			entry("unslop.alpha"),
			entry("unslop.graph", { capabilities: ["graph"], requires: ["unslop.alpha"] }),
		]);
		expect(registry.ordered().map((analyzer) => analyzer.identity.id)).toEqual([
			"unslop.alpha",
			"unslop.graph",
			"unslop.cycles",
		]);
	});

	test("rejects a duplicate analyzer id deterministically", () => {
		expect(() => buildNativeRegistry([entry("unslop.a"), entry("unslop.a")])).toThrow(
			'analyzer "unslop.a" is registered more than once',
		);
	});

	test("rejects a capability owned by two analyzers deterministically", () => {
		expect(() =>
			buildNativeRegistry([
				entry("unslop.a", { capabilities: ["shared"] }),
				entry("unslop.b", { capabilities: ["shared"] }),
			]),
		).toThrow('capability "shared" is declared by both "unslop.a" and "unslop.b"');
	});

	test("rejects a metric id owned by two analyzers deterministically", () => {
		expect(() =>
			buildNativeRegistry([
				entry("unslop.a", { metrics: ["metric.one"] }),
				entry("unslop.b", { metrics: ["metric.one"] }),
			]),
		).toThrow('metric "metric.one" is declared by both "unslop.a" and "unslop.b"');
	});

	test("rejects a prerequisite that names no registered analyzer", () => {
		expect(() => buildNativeRegistry([entry("unslop.a", { requires: ["unslop.ghost"] })])).toThrow(
			'analyzer "unslop.a" requires unregistered analyzer "unslop.ghost"',
		);
	});

	test("rejects a direct dependency cycle with a canonical path", () => {
		expect(() =>
			buildNativeRegistry([
				entry("unslop.b", { requires: ["unslop.a"] }),
				entry("unslop.a", { requires: ["unslop.b"] }),
			]),
		).toThrow('analyzer dependency cycle: "unslop.a" -> "unslop.b" -> "unslop.a"');
	});

	test("rejects a self-dependency as a one-step cycle", () => {
		expect(() => buildNativeRegistry([entry("unslop.a", { requires: ["unslop.a"] })])).toThrow(
			'analyzer dependency cycle: "unslop.a" -> "unslop.a"',
		);
	});

	test("normalizes an entered-from-outside cycle to its smallest member", () => {
		expect(() =>
			buildNativeRegistry([
				entry("unslop.x", { requires: ["unslop.z"] }),
				entry("unslop.z", { requires: ["unslop.y"] }),
				entry("unslop.y", { requires: ["unslop.z"] }),
			]),
		).toThrow('analyzer dependency cycle: "unslop.y" -> "unslop.z" -> "unslop.y"');
	});

	test("rejects an identity that violates the native namespace contract", () => {
		expect(() =>
			buildNativeRegistry([
				entry("unslop.ok"),
				{
					identity: { ...identity("foreign.tool"), kind: "native" },
					capabilities: ["foreign"],
					metrics: [],
					requires: [],
				},
			]),
		).toThrow(
			"native analyzer identity \"foreign.tool\" is invalid: id: a native provider id must be under the 'unslop.' namespace",
		);
	});
});

describe("scoringCatalogMetricIds", () => {
	test("returns the current scoring formula's term ids, sorted and unique", () => {
		expect(scoringCatalogMetricIds()).toEqual([
			"duplication.density.production",
			"duplication.groups.production",
			"erosion.eroded-count.production",
			"erosion.eroded-share.production",
			"import-cycle.density",
			"import-cycle.groups",
		]);
	});
});

describe("requiredForScoring", () => {
	test("derives catalog owners plus transitive prerequisites, excluding metric-free analyzers", () => {
		const registry = buildNativeRegistry([
			entry("unslop.complexity", { metrics: ["erosion.eroded-count.production"] }),
			entry("unslop.duplication", { metrics: ["duplication.groups.production"] }),
			entry("unslop.dependency-graph", { metrics: ["graph.files"] }),
			entry("unslop.import-cycles", {
				metrics: ["import-cycle.groups"],
				requires: ["unslop.dependency-graph"],
			}),
			entry("unslop.safeguards"),
		]);
		expect(requiredForScoring(registry)).toEqual([
			"unslop.complexity",
			"unslop.dependency-graph",
			"unslop.duplication",
			"unslop.import-cycles",
		]);
	});

	test("honors an explicit catalog", () => {
		const registry = buildNativeRegistry([
			entry("unslop.a", { metrics: ["metric.a"] }),
			entry("unslop.b"),
		]);
		expect(requiredForScoring(registry, ["metric.a"])).toEqual(["unslop.a"]);
	});
});
