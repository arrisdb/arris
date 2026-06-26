use std::collections::HashMap;

use sqlparser::ast::{
    Expr, FunctionArg, FunctionArgExpr, FunctionArguments, ObjectNamePart, Query, Select,
    SelectItem, SelectItemQualifiedWildcardKind, SetExpr, TableFactor, TableWithJoins,
};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;

use super::types::{ColumnLineageEdge, ColumnLineageGraph, ColumnLineageNode};

pub(crate) struct ColumnLineageExtractor {
    resolved_columns: HashMap<String, Vec<String>>,
}

impl ColumnLineageExtractor {
    pub fn new() -> Self {
        Self {
            resolved_columns: HashMap::new(),
        }
    }

    pub fn extract(
        &mut self,
        compiled_sqls: &HashMap<String, String>,
        model_deps: &[(String, Vec<String>)],
        source_columns: &HashMap<String, Vec<String>>,
    ) -> ColumnLineageGraph {
        for (model_id, cols) in source_columns {
            self.resolved_columns.insert(model_id.clone(), cols.clone());
        }

        let sorted = Self::topological_sort(model_deps);

        let mut all_edges: Vec<ColumnLineageEdge> = Vec::new();

        for model_id in &sorted {
            let short_name = model_id.rsplit('.').next().unwrap_or(model_id);

            let sql = match compiled_sqls.get(short_name) {
                Some(s) => s,
                None => continue,
            };

            let deps: Vec<String> = model_deps
                .iter()
                .find(|(id, _)| id == model_id)
                .map(|(_, d)| d.clone())
                .unwrap_or_default();

            match self.parse_model_sql(model_id, sql, &deps) {
                Ok(edges) => all_edges.extend(edges),
                Err(()) => continue,
            }
        }

        let resolved_edges = Self::collapse_cte_edges(&all_edges);

        let nodes: Vec<ColumnLineageNode> = self
            .resolved_columns
            .iter()
            .filter(|(id, _)| !id.starts_with("__cte__."))
            .map(|(id, cols)| ColumnLineageNode {
                model_id: id.clone(),
                columns: cols.clone(),
            })
            .collect();

        ColumnLineageGraph {
            nodes,
            edges: resolved_edges,
        }
    }
}

impl ColumnLineageExtractor {
    fn collapse_cte_edges(edges: &[ColumnLineageEdge]) -> Vec<ColumnLineageEdge> {
        let mut resolved: Vec<ColumnLineageEdge> = edges.to_vec();

        for _ in 0..10 {
            let mut next = Vec::new();
            let mut changed = false;

            for edge in &resolved {
                if edge.from_model.starts_with("__cte__.") {
                    let upstream: Vec<&ColumnLineageEdge> = resolved
                        .iter()
                        .filter(|e| e.to_model == edge.from_model && e.to_column == edge.from_column)
                        .collect();

                    if upstream.is_empty() {
                        next.push(edge.clone());
                    } else {
                        changed = true;
                        for up in upstream {
                            next.push(ColumnLineageEdge {
                                from_model: up.from_model.clone(),
                                from_column: up.from_column.clone(),
                                to_model: edge.to_model.clone(),
                                to_column: edge.to_column.clone(),
                            });
                        }
                    }
                } else {
                    next.push(edge.clone());
                }
            }

            resolved = next;
            if !changed {
                break;
            }
        }

        resolved
            .into_iter()
            .filter(|e| !e.from_model.starts_with("__cte__.") && !e.to_model.starts_with("__cte__."))
            .collect()
    }

    fn topological_sort(model_deps: &[(String, Vec<String>)]) -> Vec<String> {
        let mut in_degree: HashMap<&str, usize> = HashMap::new();
        let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();

        for (id, deps) in model_deps {
            in_degree.entry(id.as_str()).or_insert(0);
            adjacency.entry(id.as_str()).or_default();
            for dep in deps {
                in_degree.entry(dep.as_str()).or_insert(0);
                adjacency.entry(dep.as_str()).or_default().push(id.as_str());
                *in_degree.entry(id.as_str()).or_insert(0) += 1;
            }
        }

        let mut queue: Vec<&str> = in_degree
            .iter()
            .filter(|(_, deg)| **deg == 0)
            .map(|(&id, _)| id)
            .collect();
        queue.sort(); // deterministic ordering

        let mut result = Vec::new();
        while let Some(node) = queue.pop() {
            result.push(node.to_string());
            if let Some(neighbors) = adjacency.get(node) {
                for &neighbor in neighbors {
                    if let Some(deg) = in_degree.get_mut(neighbor) {
                        *deg -= 1;
                        if *deg == 0 {
                            queue.push(neighbor);
                            queue.sort();
                        }
                    }
                }
            }
        }

        result
    }

    fn parse_model_sql(
        &mut self,
        model_id: &str,
        sql: &str,
        deps: &[String],
    ) -> Result<Vec<ColumnLineageEdge>, ()> {
        let dialect = GenericDialect {};
        let statements = Parser::parse_sql(&dialect, sql).map_err(|_| ())?;

        let query = statements
            .iter()
            .rev()
            .find_map(|stmt| match stmt {
                sqlparser::ast::Statement::Query(q) => Some(q),
                _ => None,
            })
            .ok_or(())?;

        self.process_query(model_id, query, deps)
    }

    fn process_query(
        &mut self,
        model_id: &str,
        query: &Query,
        deps: &[String],
    ) -> Result<Vec<ColumnLineageEdge>, ()> {
        let mut cte_edges: Vec<ColumnLineageEdge> = Vec::new();
        if let Some(ref with) = query.with {
            for cte in &with.cte_tables {
                let cte_name = cte.alias.name.value.to_lowercase();
                let cte_id = format!("__cte__.{cte_name}");
                if let Ok(edges) = self.process_query(&cte_id, &cte.query, deps) {
                    cte_edges.extend(edges);
                }
            }
        }

        match query.body.as_ref() {
            SetExpr::Select(select) => {
                let table_aliases = self.resolve_table_aliases(&select.from, deps);
                let (output_cols, mut edges) =
                    self.extract_select_columns(select, &table_aliases, model_id, deps);
                self.resolved_columns
                    .insert(model_id.to_string(), output_cols);
                edges.extend(cte_edges);
                Ok(edges)
            }
            SetExpr::SetOperation { left, .. } => {
                let temp_query = Query {
                    with: None,
                    body: left.clone(),
                    order_by: None,
                    limit_clause: None,
                    fetch: None,
                    locks: Vec::new(),
                    for_clause: None,
                    settings: None,
                    format_clause: None,
                    pipe_operators: Vec::new(),
                };
                match self.process_query(model_id, &temp_query, deps) {
                    Ok(mut edges) => {
                        edges.extend(cte_edges);
                        Ok(edges)
                    }
                    Err(e) => Err(e),
                }
            }
            _ => Err(()),
        }
    }

    fn resolve_table_aliases(
        &self,
        from: &[TableWithJoins],
        deps: &[String],
    ) -> HashMap<String, String> {
        let mut aliases: HashMap<String, String> = HashMap::new();

        for table_with_joins in from {
            self.resolve_table_factor(&table_with_joins.relation, deps, &mut aliases);
            for join in &table_with_joins.joins {
                self.resolve_table_factor(&join.relation, deps, &mut aliases);
            }
        }

        aliases
    }

    fn resolve_table_factor(
        &self,
        factor: &TableFactor,
        deps: &[String],
        aliases: &mut HashMap<String, String>,
    ) {
        if let TableFactor::Table { name, alias, .. } = factor {
            let table_name = name
                .0
                .iter()
                .filter_map(|part| match part {
                    ObjectNamePart::Identifier(ident) => Some(ident.value.to_lowercase()),
                    _ => None,
                })
                .last()
                .unwrap_or_default();

            // Try matching against dep short names or CTE names.
            let matched_id = deps
                .iter()
                .find(|dep| {
                    let dep_lower = dep.to_lowercase();
                    let short = dep_lower.rsplit('.').next().unwrap_or(&dep_lower);
                    if short == table_name {
                        return true;
                    }
                    // SQLmesh `render` expands deps to physical table names shaped
                    // `<schema>__<model>__<fingerprint>` (dots in the logical name
                    // become `__`). Match the dep's logical name as a prefix bounded
                    // by the `__<fingerprint>` suffix so `stg_orders` does not match
                    // `stg_order_items` and vice versa.
                    let physical_prefix = dep_lower.replace('.', "__");
                    table_name == physical_prefix
                        || table_name.starts_with(&format!("{physical_prefix}__"))
                })
                .cloned()
                .or_else(|| {
                    // Check if it's a CTE
                    let cte_id = format!("__cte__.{table_name}");
                    if self.resolved_columns.contains_key(&cte_id) {
                        Some(cte_id)
                    } else {
                        None
                    }
                });

            if let Some(model_id) = matched_id {
                aliases.insert(table_name.clone(), model_id.clone());
                if let Some(alias) = alias {
                    aliases.insert(alias.name.value.to_lowercase(), model_id);
                }
            }
        }
    }

    fn extract_select_columns(
        &self,
        select: &Select,
        table_aliases: &HashMap<String, String>,
        model_id: &str,
        deps: &[String],
    ) -> (Vec<String>, Vec<ColumnLineageEdge>) {
        let mut output_cols = Vec::new();
        let mut edges = Vec::new();

        for item in &select.projection {
            match item {
                SelectItem::UnnamedExpr(expr) => {
                    let col_name = Self::expr_output_name(expr);
                    let refs = self.collect_column_refs(expr, table_aliases);
                    for (src_model, src_col) in &refs {
                        edges.push(ColumnLineageEdge {
                            from_model: src_model.clone(),
                            from_column: src_col.clone(),
                            to_model: model_id.to_string(),
                            to_column: col_name.clone(),
                        });
                    }
                    output_cols.push(col_name);
                }
                SelectItem::ExprWithAlias { expr, alias } => {
                    let col_name = alias.value.to_lowercase();
                    let refs = self.collect_column_refs(expr, table_aliases);
                    for (src_model, src_col) in &refs {
                        edges.push(ColumnLineageEdge {
                            from_model: src_model.clone(),
                            from_column: src_col.clone(),
                            to_model: model_id.to_string(),
                            to_column: col_name.clone(),
                        });
                    }
                    output_cols.push(col_name);
                }
                SelectItem::Wildcard(_) => {
                    // Resolve from all upstream models in scope
                    let upstream_ids: Vec<String> = self.upstream_model_ids(table_aliases, deps);
                    for upstream_id in &upstream_ids {
                        if let Some(cols) = self.resolved_columns.get(upstream_id) {
                            for col in cols {
                                edges.push(ColumnLineageEdge {
                                    from_model: upstream_id.clone(),
                                    from_column: col.clone(),
                                    to_model: model_id.to_string(),
                                    to_column: col.clone(),
                                });
                                if !output_cols.contains(col) {
                                    output_cols.push(col.clone());
                                }
                            }
                        }
                    }
                }
                SelectItem::QualifiedWildcard(kind, _) => {
                    if let SelectItemQualifiedWildcardKind::ObjectName(obj_name) = kind {
                        let qualifier = obj_name
                            .0
                            .iter()
                            .filter_map(|part| match part {
                                ObjectNamePart::Identifier(ident) => {
                                    Some(ident.value.to_lowercase())
                                }
                                _ => None,
                            })
                            .last()
                            .unwrap_or_default();

                        if let Some(upstream_id) = table_aliases.get(&qualifier) {
                            if let Some(cols) = self.resolved_columns.get(upstream_id) {
                                for col in cols {
                                    edges.push(ColumnLineageEdge {
                                        from_model: upstream_id.clone(),
                                        from_column: col.clone(),
                                        to_model: model_id.to_string(),
                                        to_column: col.clone(),
                                    });
                                    if !output_cols.contains(col) {
                                        output_cols.push(col.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        (output_cols, edges)
    }

    fn expr_output_name(expr: &Expr) -> String {
        match expr {
            Expr::Identifier(ident) => ident.value.to_lowercase(),
            Expr::CompoundIdentifier(parts) => {
                parts.last().map(|i| i.value.to_lowercase()).unwrap_or_default()
            }
            _ => format!("{expr}").to_lowercase(),
        }
    }

    fn upstream_model_ids(
        &self,
        table_aliases: &HashMap<String, String>,
        deps: &[String],
    ) -> Vec<String> {
        let mut ids: Vec<String> = table_aliases.values().cloned().collect();
        // Fall back to deps if no aliases resolved
        if ids.is_empty() {
            ids = deps.to_vec();
        }
        ids.sort();
        ids.dedup();
        ids
    }

    fn collect_column_refs(
        &self,
        expr: &Expr,
        table_aliases: &HashMap<String, String>,
    ) -> Vec<(String, String)> {
        let mut refs = Vec::new();
        self.walk_expr(expr, table_aliases, &mut refs);
        refs
    }

    fn walk_expr(
        &self,
        expr: &Expr,
        table_aliases: &HashMap<String, String>,
        refs: &mut Vec<(String, String)>,
    ) {
        match expr {
            Expr::Identifier(ident) => {
                let col_name = ident.value.to_lowercase();
                // Try to find which upstream model has this column
                if let Some(model_id) = self.find_column_owner(&col_name, table_aliases) {
                    refs.push((model_id, col_name));
                }
            }
            Expr::CompoundIdentifier(parts) if parts.len() >= 2 => {
                let table = parts[parts.len() - 2].value.to_lowercase();
                let col = parts[parts.len() - 1].value.to_lowercase();
                if let Some(model_id) = table_aliases.get(&table) {
                    refs.push((model_id.clone(), col));
                }
            }
            Expr::BinaryOp { left, right, .. } => {
                self.walk_expr(left, table_aliases, refs);
                self.walk_expr(right, table_aliases, refs);
            }
            Expr::UnaryOp { expr: inner, .. } => {
                self.walk_expr(inner, table_aliases, refs);
            }
            Expr::Nested(inner) => {
                self.walk_expr(inner, table_aliases, refs);
            }
            Expr::Function(func) => {
                if let FunctionArguments::List(arg_list) = &func.args {
                    for arg in &arg_list.args {
                        match arg {
                            FunctionArg::Unnamed(FunctionArgExpr::Expr(e)) => {
                                self.walk_expr(e, table_aliases, refs);
                            }
                            FunctionArg::Named { arg: FunctionArgExpr::Expr(e), .. } => {
                                self.walk_expr(e, table_aliases, refs);
                            }
                            FunctionArg::ExprNamed { arg: FunctionArgExpr::Expr(e), .. } => {
                                self.walk_expr(e, table_aliases, refs);
                            }
                            _ => {}
                        }
                    }
                }
            }
            Expr::Cast { expr: inner, .. } => {
                self.walk_expr(inner, table_aliases, refs);
            }
            Expr::Case { operand, conditions, else_result, .. } => {
                if let Some(op) = operand {
                    self.walk_expr(op, table_aliases, refs);
                }
                for case_when in conditions {
                    self.walk_expr(&case_when.condition, table_aliases, refs);
                    self.walk_expr(&case_when.result, table_aliases, refs);
                }
                if let Some(el) = else_result {
                    self.walk_expr(el, table_aliases, refs);
                }
            }
            Expr::Subquery(_) => {
                // Skip subqueries for now
            }
            _ => {}
        }
    }

    fn find_column_owner(
        &self,
        col_name: &str,
        table_aliases: &HashMap<String, String>,
    ) -> Option<String> {
        // Look through all upstream models in scope and find which one has this column
        let mut candidates: Vec<&String> = Vec::new();
        for model_id in table_aliases.values() {
            if let Some(cols) = self.resolved_columns.get(model_id) {
                if cols.iter().any(|c| c == col_name) {
                    candidates.push(model_id);
                }
            }
        }
        // Return first match (ambiguous references just pick one)
        candidates.into_iter().next().cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_source_columns(entries: &[(&str, &[&str])]) -> HashMap<String, Vec<String>> {
        entries
            .iter()
            .map(|(id, cols)| (id.to_string(), cols.iter().map(|c| c.to_string()).collect()))
            .collect()
    }

    fn make_compiled_sqls(entries: &[(&str, &str)]) -> HashMap<String, String> {
        entries
            .iter()
            .map(|(name, sql)| (name.to_string(), sql.to_string()))
            .collect()
    }

    #[test]
    fn simple_select() {
        let compiled = make_compiled_sqls(&[("stg_users", "SELECT id, name FROM users")]);
        let model_deps = vec![(
            "model.app.stg_users".to_string(),
            vec!["source.app.raw.users".to_string()],
        )];
        let source_cols =
            make_source_columns(&[("source.app.raw.users", &["id", "name", "email"])]);

        let mut extractor = ColumnLineageExtractor::new();
        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        let edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| e.to_model == "model.app.stg_users")
            .collect();
        assert_eq!(edges.len(), 2, "expected 2 edges, got: {edges:?}");
        assert!(edges
            .iter()
            .any(|e| e.from_column == "id" && e.to_column == "id"));
        assert!(edges
            .iter()
            .any(|e| e.from_column == "name" && e.to_column == "name"));
    }

    #[test]
    fn sqlmesh_quoted_three_part_names_resolve_email_edge() {
        // Real `sqlmesh render --no-format` output: identifiers double-quoted,
        // tables 3-part (catalog.schema.table). The resolver must still map the
        // alias to the dep via the last name segment.
        let sql = r#"SELECT
  "c"."customer_id" AS "customer_id",
  "c"."email" AS "email",
  "cc"."country_name" AS "country_name"
FROM "memory"."analytics_shop"."stg_customers" AS "c"
LEFT JOIN "memory"."analytics_shop"."country_codes" AS "cc"
  ON "c"."country_code" = "cc"."country_code""#;
        let compiled = make_compiled_sqls(&[("dim_customers", sql)]);
        let model_deps = vec![(
            "analytics_shop.dim_customers".to_string(),
            vec![
                "analytics_shop.stg_customers".to_string(),
                "analytics_shop.country_codes".to_string(),
            ],
        )];
        let source_cols = make_source_columns(&[
            ("analytics_shop.stg_customers", &["customer_id", "email"]),
            ("analytics_shop.country_codes", &["country_code", "country_name"]),
        ]);

        let mut extractor = ColumnLineageExtractor::new();
        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        let email = graph.edges.iter().find(|e| {
            e.to_model == "analytics_shop.dim_customers" && e.to_column == "email"
        });
        assert!(
            email.is_some(),
            "expected an email edge; edges: {:?}",
            graph.edges
        );
        let email = email.unwrap();
        assert_eq!(email.from_model, "analytics_shop.stg_customers");
        assert_eq!(email.from_column, "email");
    }

    #[test]
    fn aliased_columns() {
        let compiled =
            make_compiled_sqls(&[("stg_users", "SELECT id AS user_id FROM users")]);
        let model_deps = vec![(
            "model.app.stg_users".to_string(),
            vec!["source.app.raw.users".to_string()],
        )];
        let source_cols = make_source_columns(&[("source.app.raw.users", &["id", "name"])]);

        let mut extractor = ColumnLineageExtractor::new();
        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        let edge = graph
            .edges
            .iter()
            .find(|e| e.to_model == "model.app.stg_users")
            .expect("should have an edge");
        assert_eq!(edge.from_model, "source.app.raw.users");
        assert_eq!(edge.from_column, "id");
        assert_eq!(edge.to_column, "user_id");
    }

    #[test]
    fn expression_columns() {
        let compiled = make_compiled_sqls(&[(
            "stg_users",
            "SELECT CONCAT(first_name, last_name) AS full_name FROM users",
        )]);
        let model_deps = vec![(
            "model.app.stg_users".to_string(),
            vec!["source.app.raw.users".to_string()],
        )];
        let source_cols =
            make_source_columns(&[("source.app.raw.users", &["first_name", "last_name"])]);

        let mut extractor = ColumnLineageExtractor::new();
        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        let edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| e.to_model == "model.app.stg_users" && e.to_column == "full_name")
            .collect();
        assert_eq!(edges.len(), 2, "expected 2 source columns, got: {edges:?}");
        assert!(edges.iter().any(|e| e.from_column == "first_name"));
        assert!(edges.iter().any(|e| e.from_column == "last_name"));
    }

    #[test]
    fn join_columns() {
        let compiled = make_compiled_sqls(&[(
            "joined",
            "SELECT u.id, o.amount FROM users u JOIN orders o ON u.id = o.user_id",
        )]);
        let model_deps = vec![(
            "model.app.joined".to_string(),
            vec![
                "source.app.raw.users".to_string(),
                "source.app.raw.orders".to_string(),
            ],
        )];
        let source_cols = make_source_columns(&[
            ("source.app.raw.users", &["id", "name"]),
            ("source.app.raw.orders", &["amount", "user_id"]),
        ]);

        let mut extractor = ColumnLineageExtractor::new();
        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        let edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| e.to_model == "model.app.joined")
            .collect();
        assert_eq!(edges.len(), 2, "expected 2 edges, got: {edges:?}");
        assert!(edges
            .iter()
            .any(|e| e.from_model == "source.app.raw.users" && e.from_column == "id"));
        assert!(edges
            .iter()
            .any(|e| e.from_model == "source.app.raw.orders" && e.from_column == "amount"));
    }

    #[test]
    fn select_star() {
        let compiled = make_compiled_sqls(&[("stg_users", "SELECT * FROM users")]);
        let model_deps = vec![(
            "model.app.stg_users".to_string(),
            vec!["source.app.raw.users".to_string()],
        )];
        let source_cols =
            make_source_columns(&[("source.app.raw.users", &["id", "name", "email"])]);

        let mut extractor = ColumnLineageExtractor::new();
        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        let edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| e.to_model == "model.app.stg_users")
            .collect();
        assert_eq!(edges.len(), 3, "expected 3 edges for *, got: {edges:?}");

        let stg_node = graph
            .nodes
            .iter()
            .find(|n| n.model_id == "model.app.stg_users")
            .expect("should have stg_users node");
        assert_eq!(stg_node.columns.len(), 3);
    }

    #[test]
    fn cte_columns() {
        let compiled = make_compiled_sqls(&[(
            "final_model",
            "WITH cte AS (SELECT id FROM users) SELECT id FROM cte",
        )]);
        let model_deps = vec![(
            "model.app.final_model".to_string(),
            vec!["source.app.raw.users".to_string()],
        )];
        let source_cols =
            make_source_columns(&[("source.app.raw.users", &["id", "name", "email"])]);

        let mut extractor = ColumnLineageExtractor::new();
        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        // CTE edges collapsed: source.app.raw.users.id → model.app.final_model.id
        let edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| e.to_model == "model.app.final_model")
            .collect();
        assert_eq!(edges.len(), 1, "expected 1 edge through CTE, got: {edges:?}");
        assert_eq!(edges[0].from_model, "source.app.raw.users");
        assert_eq!(edges[0].from_column, "id");
        assert_eq!(edges[0].to_column, "id");
    }

    #[test]
    fn graceful_parse_failure() {
        let compiled =
            make_compiled_sqls(&[("bad_model", "THIS IS NOT VALID SQL AT ALL !!!")]);
        let model_deps = vec![(
            "model.app.bad_model".to_string(),
            vec!["source.app.raw.users".to_string()],
        )];
        let source_cols = make_source_columns(&[("source.app.raw.users", &["id"])]);

        let mut extractor = ColumnLineageExtractor::new();
        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        let edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| e.to_model == "model.app.bad_model")
            .collect();
        assert!(edges.is_empty(), "no edges for unparseable SQL");
    }

    #[test]
    fn topological_sort_orders_correctly() {
        // Diamond: A depends on nothing, B depends on A, C depends on A, D depends on B and C
        let model_deps = vec![
            ("a".to_string(), vec![]),
            ("b".to_string(), vec!["a".to_string()]),
            ("c".to_string(), vec!["a".to_string()]),
            (
                "d".to_string(),
                vec!["b".to_string(), "c".to_string()],
            ),
        ];
        let sorted = ColumnLineageExtractor::topological_sort(&model_deps);
        let pos = |name: &str| sorted.iter().position(|s| s == name).unwrap();
        assert!(pos("a") < pos("b"));
        assert!(pos("a") < pos("c"));
        assert!(pos("b") < pos("d"));
        assert!(pos("c") < pos("d"));
    }

    #[test]
    fn multi_cte_with_star_passthrough() {
        let compiled = make_compiled_sqls(&[(
            "dim_customers",
            "WITH customers AS (SELECT * FROM stg_customers), \
             orders AS (SELECT * FROM stg_orders), \
             customer_orders AS ( \
                 SELECT customer_id, COUNT(*) AS order_count, SUM(amount) AS total_amount \
                 FROM orders GROUP BY customer_id \
             ) \
             SELECT c.customer_id, c.first_name, c.last_name, c.email, \
                    COALESCE(co.order_count, 0) AS order_count, \
                    COALESCE(co.total_amount, 0) AS total_amount \
             FROM customers c LEFT JOIN customer_orders co ON c.customer_id = co.customer_id",
        )]);
        let model_deps = vec![
            (
                "model.shop.stg_customers".to_string(),
                vec!["source.shop.jaffle_shop.raw_customers".to_string()],
            ),
            (
                "model.shop.stg_orders".to_string(),
                vec!["source.shop.jaffle_shop.raw_orders".to_string()],
            ),
            (
                "model.shop.dim_customers".to_string(),
                vec![
                    "model.shop.stg_customers".to_string(),
                    "model.shop.stg_orders".to_string(),
                ],
            ),
        ];
        let source_cols = make_source_columns(&[
            ("source.shop.jaffle_shop.raw_customers", &["id", "first_name", "last_name", "email"]),
            ("source.shop.jaffle_shop.raw_orders", &["id", "customer_id", "order_date", "amount"]),
        ]);

        let mut extractor = ColumnLineageExtractor::new();
        // Pre-populate resolved columns for stg models (simulating earlier extraction)
        extractor.resolved_columns.insert(
            "model.shop.stg_customers".to_string(),
            vec!["customer_id".to_string(), "first_name".to_string(), "last_name".to_string(), "email".to_string()],
        );
        extractor.resolved_columns.insert(
            "model.shop.stg_orders".to_string(),
            vec!["order_id".to_string(), "customer_id".to_string(), "order_date".to_string(), "status".to_string(), "amount".to_string()],
        );

        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        // CTE edges collapsed: edges should point to real models, not __cte__
        let dim_edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| e.to_model == "model.shop.dim_customers")
            .collect();

        assert!(
            dim_edges.iter().any(|e| e.from_model == "model.shop.stg_customers" && e.from_column == "first_name" && e.to_column == "first_name"),
            "expected stg_customers.first_name → dim_customers.first_name, got: {dim_edges:?}"
        );
        assert!(
            dim_edges.iter().any(|e| e.from_model == "model.shop.stg_customers" && e.from_column == "last_name" && e.to_column == "last_name"),
            "expected stg_customers.last_name → dim_customers.last_name, got: {dim_edges:?}"
        );
        assert!(
            dim_edges.iter().any(|e| e.from_model == "model.shop.stg_customers" && e.from_column == "email" && e.to_column == "email"),
            "expected stg_customers.email → dim_customers.email, got: {dim_edges:?}"
        );
        // No CTE nodes in output
        assert!(
            graph.nodes.iter().all(|n| !n.model_id.starts_with("__cte__.")),
            "CTE nodes should be filtered out"
        );
    }

    #[test]
    fn sqlmesh_physical_table_names_resolve() {
        // SQLmesh `render` expands dependencies to their physical table names,
        // shaped `<schema>__<model>__<fingerprint>` and schema-qualified, e.g.
        // `"postgres"."sqlmesh__analytics_shop"."analytics_shop__stg_customers__3407084779"`.
        // The extractor must map those back to the logical dep names so column
        // edges still form (regression: customer_id had no lineage).
        let compiled = make_compiled_sqls(&[(
            "fct_orders",
            r#"SELECT
                 "o"."order_id" AS "order_id",
                 "c"."customer_id" AS "customer_id",
                 "c"."full_name" AS "customer_name"
               FROM "postgres"."sqlmesh__analytics_shop"."analytics_shop__stg_orders__1983405719" AS "o"
               INNER JOIN "postgres"."sqlmesh__analytics_shop"."analytics_shop__stg_customers__3407084779" AS "c"
                 ON "c"."customer_id" = "o"."customer_id""#,
        )]);
        let model_deps = vec![(
            "analytics_shop.fct_orders".to_string(),
            vec![
                "analytics_shop.stg_orders".to_string(),
                "analytics_shop.stg_customers".to_string(),
            ],
        )];
        let source_cols = make_source_columns(&[
            ("analytics_shop.stg_orders", &["order_id", "customer_id"]),
            ("analytics_shop.stg_customers", &["customer_id", "full_name"]),
        ]);

        let mut extractor = ColumnLineageExtractor::new();
        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        let edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| e.to_model == "analytics_shop.fct_orders")
            .collect();

        // customer_id is projected from the stg_customers alias `c`.
        assert!(
            edges.iter().any(|e| e.from_model == "analytics_shop.stg_customers"
                && e.from_column == "customer_id"
                && e.to_column == "customer_id"),
            "customer_id should resolve to stg_customers, got: {edges:?}"
        );
        // order_id from the stg_orders alias `o`.
        assert!(
            edges.iter().any(|e| e.from_model == "analytics_shop.stg_orders"
                && e.from_column == "order_id"
                && e.to_column == "order_id"),
            "order_id should resolve to stg_orders, got: {edges:?}"
        );
    }

    #[test]
    fn similar_model_names_dont_cross_match() {
        // `stg_orders` and `stg_order_items` share a prefix; the physical-name
        // matcher must not resolve one dep's columns to the other.
        let compiled = make_compiled_sqls(&[(
            "fct",
            r#"SELECT "oi"."order_item_id" AS "order_item_id"
               FROM "db"."sch"."analytics_shop__stg_order_items__795312863" AS "oi""#,
        )]);
        let model_deps = vec![(
            "analytics_shop.fct".to_string(),
            vec![
                "analytics_shop.stg_orders".to_string(),
                "analytics_shop.stg_order_items".to_string(),
            ],
        )];
        let source_cols = make_source_columns(&[
            ("analytics_shop.stg_orders", &["order_id"]),
            ("analytics_shop.stg_order_items", &["order_item_id"]),
        ]);

        let mut extractor = ColumnLineageExtractor::new();
        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        let edge = graph
            .edges
            .iter()
            .find(|e| e.to_model == "analytics_shop.fct" && e.to_column == "order_item_id")
            .expect("order_item_id edge should exist");
        assert_eq!(edge.from_model, "analytics_shop.stg_order_items");
    }

    #[test]
    fn unresolved_table_skipped() {
        // Column references an unknown table — should produce no edges, no panic
        let compiled =
            make_compiled_sqls(&[("my_model", "SELECT x.col1 FROM unknown_table x")]);
        let model_deps = vec![(
            "model.app.my_model".to_string(),
            vec!["source.app.raw.users".to_string()],
        )];
        let source_cols =
            make_source_columns(&[("source.app.raw.users", &["id", "name"])]);

        let mut extractor = ColumnLineageExtractor::new();
        let graph = extractor.extract(&compiled, &model_deps, &source_cols);

        let edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| e.to_model == "model.app.my_model")
            .collect();
        assert!(
            edges.is_empty(),
            "no edges when table cannot be resolved, got: {edges:?}"
        );
    }
}
