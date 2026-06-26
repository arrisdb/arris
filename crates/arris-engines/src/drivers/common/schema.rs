use crate::{SchemaNode, SchemaNodeKind};

/// Finds the schema/database container node named `name` at any depth in a
/// schema tree (some drivers nest schemas under a database node), returning it
/// as the single-element subtree callers expect from `list_schema`.
///
/// Drivers that load their whole tree cheaply use this to satisfy the required
/// `DatabaseDriver::list_schema` method: re-list everything, then pluck the one
/// container. Drivers where eager loading is expensive override `list_schema`
/// with a targeted query instead.
pub fn find_schema_node(nodes: &[SchemaNode], name: &str) -> Vec<SchemaNode> {
    fn find(nodes: &[SchemaNode], name: &str) -> Option<SchemaNode> {
        for node in nodes {
            if matches!(node.kind, SchemaNodeKind::Schema | SchemaNodeKind::Database)
                && node.name == name
            {
                return Some(node.clone());
            }
            if let Some(found) = find(&node.children, name) {
                return Some(found);
            }
        }
        None
    }
    find(nodes, name).into_iter().collect()
}
