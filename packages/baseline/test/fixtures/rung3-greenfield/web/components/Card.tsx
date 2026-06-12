export function OfferCard({ title }: { title: string }) {
  return <div className="card">{title}</div>;
}

export const PriceTag = ({ amount }: { amount: number }) => <span>{amount}</span>;

// helper, not a component
export const formatPrice = (n: number) => n.toFixed(2);
