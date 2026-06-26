/// Props for the transaction reference pane, which lists the statements run in
/// the connection's open manual transaction.
interface TransactionPaneProps {
  connectionId: string;
  onCollapse: () => void;
}

export type { TransactionPaneProps };
