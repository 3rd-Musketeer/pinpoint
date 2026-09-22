export default function Hello() {
  return (
    <div className="ios-app">
      <div className="ios-page" style={{ padding: '24px' }}>
        <h1>E2E jsx-site hello</h1>
        {[1, 2].map((n) => <p key={n} data-row>row {n}</p>)}
      </div>
    </div>
  );
}
