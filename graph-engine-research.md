# Graph Engine Research: Memgraph & Neo4j Capabilities for ARGUS

> Research compiled: 2026-08-31
> Sources: Memgraph docs, Neo4j GDS docs, MAGE repository, academic papers (Aion temporal graph), community forums

---

## 1. Cypher Query Language Features to Support

Cypher is the lingua franca of graph queries. A world-class intelligence engine must support these core constructs:

### Core Clauses (Must-Have)
| Clause | Purpose | Intelligence Use Case |
|--------|---------|----------------------|
| `MATCH` / `OPTIONAL MATCH` | Pattern matching with null-fill for missing parts | Entity resolution with incomplete data |
| `WHERE` | Filter constraints on patterns | Time-window filtering, confidence thresholds |
| `WITH` | Query pipelining, aggregation, scope control | Multi-stage analysis pipelines |
| `RETURN` / `UNWIND` | Result shaping, list expansion | Report generation, batch processing |
| `CREATE` / `MERGE` / `SET` | Upsert nodes/relationships with properties | Incremental intelligence ingestion |
| `DELETE` / `REMOVE` / `DETACH DELETE` | Graph mutation, cleanup | Data retention, entity purging |
| `CALL {subquery}` | Scoped subqueries (read/write), per-row execution | Isolated analysis per entity |
| `CALL {} IN TRANSACTIONS` | Batched subquery execution | Bulk data ingestion without OOM |
| `UNION` / `UNION ALL` | Result combination | Multi-source intelligence fusion |

### Advanced Cypher Constructs
- **Path patterns**: `(a)-[:KNOWS*1..5]->(b)` — variable-length traversals for multi-hop relationship discovery
- **Weighted shortest path / All shortest paths**: Built-in pathfinding primitives (Memgraph has these in core; Neo4j via GDS)
- **ACYCLIC path keyword**: Prevents node/relationship repetition within a path
- **List comprehensions**: `[x IN list WHERE x.prop > 5 | x.name]` — inline filtering/projection
- **Aggregating functions**: `count()`, `collect()`, `sum()`, `avg()`, `percentileCont()`, `stDev()`
- **Existential subqueries**: `EXISTS { MATCH (a)-[:SEEN]->(b) }` — pattern existence checks
- **COUNT subqueries**: `COUNT { MATCH ... }` — counting matches without materializing
- **Temporal types**: `Date`, `DateTime`, `Time`, `Duration` — native time arithmetic
- **Parameters**: `$paramName` — query plan caching, injection safety

### Memgraph-Specific Enhancements Worth Adopting
- **Deep-path constructs**: `DFS`, `BFS`, `Weighted Shortest Path`, `All Shortest Paths` as first-class Cypher primitives (not library calls)
- **Inline path filtering**: Filter during traversal, not after — massive speedup for deep paths
- **Custom query modules**: User-callable procedures via `CALL module.proc()` — extensible by design

---

## 2. Graph Data Science (GDS) Algorithms

Both MAGE (Memgraph) and GDS (Neo4j) provide 40-50+ algorithms. For an intelligence system, prioritize:

### Centrality Algorithms (Identify Key Actors)
| Algorithm | What It Finds | Intelligence Value |
|-----------|---------------|-------------------|
| **PageRank** | Influence/importance via incoming links | Identify kingpins in networks |
| **Betweenness Centrality** | Nodes that bridge communities | Find brokers, cutpoints, single points of failure |
| **Degree Centrality** | Raw connection count | Quick influence proxy |
| **Katz Centrality** | Influence weighted by path length | Long-range influence detection |
| **Eigenvector Centrality** | Importance based on neighbors' importance | Recursive influence scoring |

### Community Detection (Find Clusters)
| Algorithm | Complexity | Notes |
|-----------|------------|-------|
| **Louvain** | O(n log n) | Hierarchical modularity optimization; MAGE has this |
| **Leiden** | O(L × m) | Louvain improvement — handles disconnected communities; in both MAGE & GDS |
| **Label Propagation** | O(m) | Fast, near-linear; good for streaming |
| **Speaker-Listener LPA** | — | GDS production-quality; handles overlapping communities |
| **K-Core Decomposition** | — | Nested core structure; find tightly-knit groups |
| **Strongly Connected Components** | O(V+E) | Directed graph clustering |
| **Weakly Connected Components** | O(V+E) | Basic connectivity; GDS has optimized WCC |
| **HDBSCAN** | — | Density-based; GDS production-quality |

### Node Embeddings (ML Feature Generation)
| Algorithm | Output | Use |
|-----------|--------|-----|
| **node2vec** | Dense vector per node | Similarity search, ML features, visualization |
| **FastRP** | Random projection embeddings | Fast, scalable node features |
| **GraphSAGE** | Inductive node embeddings | Generalize to unseen nodes |

### Link Prediction (Discover Hidden Connections)
| Method | Type | Notes |
|--------|------|-------|
| **Topological link prediction** | Heuristic | Common Neighbors, Preferential Attachment, Adamic Adar |
| **GNN-based link prediction** | ML | MAGE has `gnn_link_prediction`; GDS has link prediction pipeline |
| **Node similarity** | Jaccard/Cosine | MAGE has `node_similarity` module |

### Pathfinding
| Algorithm | Use |
|-----------|-----|
| **Dijkstra (weighted shortest path)** | Optimal route with costs |
| **A\*** | Heuristic-guided shortest path |
| **All Shortest Paths** | Enumerate all optimal paths |
| **Minimum Spanning Tree** | Network structure analysis |
| **Maximum Flow** | Capacity/bottleneck analysis |

### Dynamic/Streaming Algorithms (Critical for Real-Time Intelligence)
MAGE uniquely provides **online variants** that update incrementally:
- `pagerank_online` — streaming PageRank
- `katz_centrality_online` — streaming Katz
- `betweenness_centrality_online` — streaming betweenness
- `community_detection_online` — dynamic label propagation
- `node2vec_online` — streaming embeddings

> **Actionable**: Implement incremental/dynamic versions of core algorithms. Intelligence graphs evolve constantly; recomputing from scratch is too slow.

---

## 3. Temporal Graph Support

Time is non-negotiable for intelligence. Both databases handle this via data modeling, not native temporal types.

### Modeling Approaches

**1. Valid-Time Range Pattern (Most Common)**
```
(node)-[:RELATIONSHIP {validFrom: datetime(), validTo: datetime()}]->(node)
```
- `validTo = NULL` or `∞` means "currently active"
- Query: `WHERE r.validFrom <= $asOf AND (r.validTo IS NULL OR r.validTo > $asOf)`

**2. Temporal Versioning with State Nodes**
```
(Entity)-[:HAS_STATE]->(State {from: t1, to: t2})-[:NEXT]->(State2 {from: t2, to: t3})
```
- Each state change creates a new node; chain via `:NEXT`
- Point-in-time query: traverse chain to find state valid at time T

**3. Bi-Temporal (Aion Research Paper — EDBT 2024)**
- **Valid time**: When something was true in reality
- **Transaction time**: When the database recorded it
- Aion (built on Neo4j) uses hybrid storage: `TimeStore` (global snapshots) + `LineageStore` (per-entity history)
- Only 28-41% storage overhead; <15% ingestion overhead; 10× faster temporal queries

**4. Temporal Connected Components (Neo4j Fraud Detection Pattern)**
- `:SAME_CC_AS` relationships link events chronologically
- Prevents "future leakage" — critical for ML training on temporal data
- Enables "as-of-date" queries on graph structure

### Temporal Cypher Extensions (NEP-001 Proposal)
The community is pushing for native `AS OF` syntax:
```cypher
MATCH (a)-[r:KNOWS]->(b) AS OF datetime('2025-01-01')
```
With functions: `temporal.activeAt(rel, date)`, `temporal.asOf.traverse(node, types, date, depth)`

> **Actionable**: Build temporal validity into the core data model (validFrom/validTo on all relationships). Implement AS-OF query semantics as a first-class feature, not an afterthought.

---

## 4. Indexing Strategies for Fast Lookups

### Index Types to Implement

| Index Type | Backend | Use Case |
|------------|---------|----------|
| **B+Tree (Range Index)** | Default | Exact match, range scans, prefix/suffix, ordering |
| **Composite B+Tree** | Multi-property | Combined lookups (e.g., `(type, timestamp)`) |
| **Full-Text Index** | Apache Lucene / Tantivy | Content search, fuzzy matching, relevance scoring |
| **Vector Index (HNSW)** | Lucene HNSW / USearch | Approximate nearest neighbor on embeddings |
| **Token Lookup Index** | Built-in | Label→Node and Type→Relationship mapping (Neo4j default) |
| **Point Index** | Spatial | Geospatial queries, bounding boxes, distance |
| **Hash Index** | In-memory | O(1) exact lookups on high-cardinality properties |

### Key Indexing Principles from Neo4j/Memgraph
1. **Index after load** — Building indexes during bulk ingestion is slow; create after data load
2. **Composite indexes** for multi-property equality checks (but not range queries)
3. **Full-text indexes** support scoring, stemming, stop-word removal — critical for intelligence text search
4. **Vector indexes** (HNSW) require separate memory allocation (not shared with page cache)
5. **Index-free adjacency** — The graph's native superpower: traversing a relationship is O(1) pointer chasing, no index needed
6. **Descending indexes** — Memgraph 2026 supports descending label-property indexes for optimized `ORDER BY DESC` queries

### Hybrid Search Pattern (Neo4j 2025+)
Combine multiple retrieval signals in one query:
```cypher
// Full-text + Vector + Graph topology, fused with WRRF
CALL db.index.fulltext.queryNodes('content', $query) YIELD node, score
WITH collect({node, score}) AS textResults
CALL db.index.vector.queryNodes('embeddings', $k, $query_vec) YIELD node, score
WITH textResults, collect({node, score}) AS vecResults
// Fuse with Weighted Reciprocal Rank Fusion
```

> **Actionable**: Implement at minimum: B+Tree (range), full-text (Lucene/Tantivy), and vector (HNSW) indexes. Support hybrid search natively.

---

## 5. Large-Scale Graph Handling

### Memgraph Architecture
- **In-memory first**: Entire graph in RAM; snapshots + WAL for durability
- **Vertical scaling**: Add RAM to handle larger graphs
- **High Availability**: Raft consensus with Coordinator nodes
  - 1 MAIN + N REPLICAs (typical: 3 data instances)
  - Cross-DC deployment for disaster recovery
- **No built-in sharding**: Cannot partition a single graph across nodes
- **Streaming**: Kafka/Pulsar/RedPanda ingestion with triggers for real-time reaction

### Neo4j Architecture
- **Disk-based with page cache**: Graph on disk; hot data in memory-mapped cache
- **Causal Clustering**: Raft-based; Primaries + Secondaries; horizontal read scale-out
- **Fabric (Federation)**: Query across multiple databases/shards as if one graph
- **Infinigraph (Property Sharding)**: Separate property storage from topology storage
  - Graph shard: nodes + relationships (lean)
  - Property shards: scalable independently with replicas
  - Enables 100TB+ scale
- **Autonomous Cluster**: Automated placement, syncing, failover

### Scaling Strategies Comparison

| Strategy | Memgraph | Neo4j | Best For |
|----------|----------|-------|----------|
| **Vertical scale** | ✅ Add RAM | ✅ Add RAM/CPU | Single-graph, fits in one machine |
| **Read replicas** | ✅ | ✅ (Causal Cluster) | Read-heavy workloads |
| **Write scaling** | ❌ No sharding | ✅ (Infinigraph) | Write-heavy, large graphs |
| **Federation** | ❌ | ✅ (Fabric) | Multiple independent graphs |
| **Cross-DC HA** | ✅ (3 DC deployment) | ✅ (Causal Cluster) | Global intelligence operations |
| **Streaming ingest** | ✅ (Kafka native) | Via Kafka Connect | Real-time intelligence feeds |

### Key Insight for ARGUS
For an intelligence system, the graph likely fits in RAM (entities + relationships of interest are bounded). Memgraph's in-memory model with Raft HA is the right target:
- Sub-millisecond multi-hop traversals
- Streaming ingest for real-time updates
- Replication for availability
- No need for complex sharding if working set fits RAM

> **Actionable**: Design for in-memory operation with snapshot+WAL durability. Implement Raft-based replication for HA. Add streaming ingest (Kafka) for real-time updates. Plan for federation if multiple independent graphs are needed.

---

## Top 20 Actionable Ideas for ARGUS Graph Engine

### Query & Language
1. **Implement core Cypher**: MATCH, WHERE, WITH, RETURN, MERGE, CREATE, DELETE, CALL subqueries, aggregations, list comprehensions
2. **Add deep-path primitives**: Variable-length traversals, DFS/BFS, weighted shortest path, all shortest paths as first-class operations
3. **Support temporal AS-OF queries**: Native syntax for point-in-time graph queries with validFrom/validTo semantics
4. **Enable custom query modules**: Extensible procedure system (like MAGE) for domain-specific algorithms

### Algorithms
5. **Centrality suite**: PageRank, Betweenness, Katz, Degree, Eigenvector — identify key actors
6. **Community detection**: Louvain, Leiden, Label Propagation, K-Core — find clusters and cells
7. **Node embeddings**: node2vec, FastRP — generate ML features, enable similarity search
8. **Link prediction**: Topological (Common Neighbors, Adamic Adar) + GNN-based — discover hidden connections
9. **Dynamic/streaming algorithms**: Incremental PageRank, streaming community detection, online centrality — keep scores fresh as data arrives
10. **Pathfinding**: Dijkstra, A\*, All Shortest Paths, Max Flow — route and capacity analysis

### Indexing & Search
11. **B+Tree range indexes**: Exact match, range scans, ordering on properties
12. **Full-text index (Lucene/Tantivy)**: Content search with scoring, stemming, relevance
13. **Vector index (HNSW)**: Approximate nearest neighbor for embedding similarity
14. **Hybrid search**: Combine full-text + vector + graph topology with rank fusion (WRRF)

### Temporal
15. **Temporal data model**: validFrom/validTo on all relationships; state versioning for nodes
16. **Temporal connected components**: Time-respecting component structure (prevents future leakage in ML)

### Scale & Operations
17. **In-memory architecture**: Keep working graph in RAM; snapshots + WAL for durability
18. **Raft-based replication**: 1 MAIN + N REPLICAs for HA; cross-DC deployment
19. **Streaming ingest**: Kafka/Pulsar native integration with triggers for real-time reaction
20. **Graph projections/catalog**: Named, filtered subgraphs for algorithm execution (like GDS graph catalog)

---

## Key Differentiators to Steal

| From Memgraph | From Neo4j |
|---------------|------------|
| In-memory C++ speed | GDS algorithm breadth (50+ algorithms) |
| Online/dynamic algorithms | Graph catalog & projections |
| Built-in streaming (Kafka) | Fabric federation |
| Deep-path Cypher primitives | Vector index + hybrid search |
| Tantivy text index | Temporal versioning patterns |
| MAGE extensibility | Pregel API for custom algorithms |
| Raft HA with coordinators | Infinigraph property sharding |

---

## References
- [Memgraph GitHub](https://github.com/memgraph/memgraph) — In-memory graph DB, Cypher-compatible
- [MAGE Algorithm Library](https://github.com/memgraph/mage) — 40+ graph algorithms in C++/Python/CUDA
- [Neo4j GDS Documentation](https://neo4j.com/docs/graph-data-science/current/) — Complete algorithm reference
- [Neo4j Cypher Manual](https://neo4j.com/docs/cypher-manual/current/) — Full language spec
- [Aion: Efficient Temporal Graph Data Management](https://openproceedings.org/2024/conf/edbt/paper-124.pdf) — EDBT 2024, bi-temporal graph DB on Neo4j
- [NEP-001: Native Bitemporal Graph Support](https://github.com/DIGITAL-FABRIC-AI/neo4j-temporal-graph) — AS-OF Cypher proposal
- [Neo4j Temporal Graph Modeling](https://neo4j.com/blog/developer/mastering-fraud-detection-temporal-graph/) — Fraud detection with temporal CC forest
- [Memgraph vs Neo4j Comparison](https://memgraph.com/blog/neo4j-vs-memgraph) — Feature/performance tradeoffs