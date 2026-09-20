'use strict';

/**
 * Beobachtungsliste: deutsche und amerikanische Werte.
 *
 * Auswahlkriterium ist Liquiditaet, nicht Bekanntheit — ein Chartsignal in
 * einem duenn gehandelten Wert ist Rauschen. `venue` steuert die Handelszeit,
 * `stooq` das Kuerzel der Zweitquelle.
 */

const DE = [
  ['SAP.DE', 'SAP', 'sap.de'],
  ['SIE.DE', 'Siemens', 'sie.de'],
  ['ALV.DE', 'Allianz', 'alv.de'],
  ['DTE.DE', 'Deutsche Telekom', 'dte.de'],
  ['AIR.DE', 'Airbus', 'air.de'],
  ['MBG.DE', 'Mercedes-Benz', 'mbg.de'],
  ['BMW.DE', 'BMW', 'bmw.de'],
  ['VOW3.DE', 'Volkswagen Vz.', 'vow3.de'],
  ['BAS.DE', 'BASF', 'bas.de'],
  ['BAYN.DE', 'Bayer', 'bayn.de'],
  ['DBK.DE', 'Deutsche Bank', 'dbk.de'],
  ['MUV2.DE', 'Munich Re', 'muv2.de'],
  ['IFX.DE', 'Infineon', 'ifx.de'],
  ['RHM.DE', 'Rheinmetall', 'rhm.de'],
  ['DHL.DE', 'DHL Group', 'dhl.de'],
  ['ADS.DE', 'Adidas', 'ads.de'],
  ['EOAN.DE', 'E.ON', 'eoan.de'],
  ['RWE.DE', 'RWE', 'rwe.de'],
  ['HEI.DE', 'Heidelberg Materials', 'hei.de'],
  ['CBK.DE', 'Commerzbank', 'cbk.de'],
];

const US = [
  ['AAPL', 'Apple', 'aapl.us'],
  ['MSFT', 'Microsoft', 'msft.us'],
  ['NVDA', 'Nvidia', 'nvda.us'],
  ['AMZN', 'Amazon', 'amzn.us'],
  ['GOOGL', 'Alphabet A', 'googl.us'],
  ['META', 'Meta Platforms', 'meta.us'],
  ['TSLA', 'Tesla', 'tsla.us'],
  ['AMD', 'AMD', 'amd.us'],
  ['AVGO', 'Broadcom', 'avgo.us'],
  ['NFLX', 'Netflix', 'nflx.us'],
  ['JPM', 'JPMorgan', 'jpm.us'],
  ['XOM', 'Exxon Mobil', 'xom.us'],
  ['UNH', 'UnitedHealth', 'unh.us'],
  ['LLY', 'Eli Lilly', 'lly.us'],
  ['COST', 'Costco', 'cost.us'],
  ['PLTR', 'Palantir', 'pltr.us'],
  ['COIN', 'Coinbase', 'coin.us'],
  ['UBER', 'Uber', 'uber.us'],
  ['CAT', 'Caterpillar', 'cat.us'],
  ['BA', 'Boeing', 'ba.us'],
];

const build = (rows, venue, market, currency) =>
  rows.map(([symbol, name, stooq]) => ({ symbol, name, stooq, venue, market, currency }));

const UNIVERSE = [
  ...build(DE, 'XETRA', 'DE', 'EUR'),
  ...build(US, 'US', 'US', 'USD'),
];

/** Leitindizes fuer die Marktlage — gleiche Abfrage, andere Rolle. */
const BENCHMARKS = [
  { symbol: '^GDAXI', name: 'DAX', market: 'DE', venue: 'XETRA' },
  { symbol: '^GSPC', name: 'S&P 500', market: 'US', venue: 'US' },
  { symbol: '^IXIC', name: 'Nasdaq Composite', market: 'US', venue: 'US' },
];

function select({ markets = ['DE', 'US'], limit = 0 } = {}) {
  let list = UNIVERSE.filter((s) => markets.includes(s.market));
  if (limit > 0) {
    // Gleichmaessig kuerzen, damit beide Maerkte vertreten bleiben.
    const perMarket = Math.ceil(limit / markets.length);
    list = markets.flatMap((m) => list.filter((s) => s.market === m).slice(0, perMarket)).slice(0, limit);
  }
  return list;
}

module.exports = { UNIVERSE, BENCHMARKS, select };
