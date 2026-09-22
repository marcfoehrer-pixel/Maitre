'use strict';

/**
 * Beobachtungsliste: deutsche und amerikanische Werte.
 *
 * Auswahlkriterium ist Liquiditaet, nicht Bekanntheit — ein Chartsignal in
 * einem duenn gehandelten Wert ist Rauschen. `venue` steuert die Handelszeit,
 * `stooq` das Kuerzel der Zweitquelle.
 */

// Spalten: Yahoo-Kuerzel · Name · Stooq-Kuerzel · Twelve-Data-Kuerzel
const DE = [
  ['SAP.DE', 'SAP', 'sap.de', 'SAP'],
  ['SIE.DE', 'Siemens', 'sie.de', 'SIE'],
  ['ALV.DE', 'Allianz', 'alv.de', 'ALV'],
  ['DTE.DE', 'Deutsche Telekom', 'dte.de', 'DTE'],
  ['AIR.DE', 'Airbus', 'air.de', 'AIR'],
  ['MBG.DE', 'Mercedes-Benz', 'mbg.de', 'MBG'],
  ['BMW.DE', 'BMW', 'bmw.de', 'BMW'],
  ['VOW3.DE', 'Volkswagen Vz.', 'vow3.de', 'VOW3'],
  ['BAS.DE', 'BASF', 'bas.de', 'BAS'],
  ['BAYN.DE', 'Bayer', 'bayn.de', 'BAYN'],
  ['DBK.DE', 'Deutsche Bank', 'dbk.de', 'DBK'],
  ['MUV2.DE', 'Munich Re', 'muv2.de', 'MUV2'],
  ['IFX.DE', 'Infineon', 'ifx.de', 'IFX'],
  ['RHM.DE', 'Rheinmetall', 'rhm.de', 'RHM'],
  ['DHL.DE', 'DHL Group', 'dhl.de', 'DHL'],
  ['ADS.DE', 'Adidas', 'ads.de', 'ADS'],
  ['EOAN.DE', 'E.ON', 'eoan.de', 'EOAN'],
  ['RWE.DE', 'RWE', 'rwe.de', 'RWE'],
  ['HEI.DE', 'Heidelberg Materials', 'hei.de', 'HEI'],
  ['CBK.DE', 'Commerzbank', 'cbk.de', 'CBK'],
];

const US = [
  ['AAPL', 'Apple', 'aapl.us', 'AAPL'],
  ['MSFT', 'Microsoft', 'msft.us', 'MSFT'],
  ['NVDA', 'Nvidia', 'nvda.us', 'NVDA'],
  ['AMZN', 'Amazon', 'amzn.us', 'AMZN'],
  ['GOOGL', 'Alphabet A', 'googl.us', 'GOOGL'],
  ['META', 'Meta Platforms', 'meta.us', 'META'],
  ['TSLA', 'Tesla', 'tsla.us', 'TSLA'],
  ['AMD', 'AMD', 'amd.us', 'AMD'],
  ['AVGO', 'Broadcom', 'avgo.us', 'AVGO'],
  ['NFLX', 'Netflix', 'nflx.us', 'NFLX'],
  ['JPM', 'JPMorgan', 'jpm.us', 'JPM'],
  ['XOM', 'Exxon Mobil', 'xom.us', 'XOM'],
  ['UNH', 'UnitedHealth', 'unh.us', 'UNH'],
  ['LLY', 'Eli Lilly', 'lly.us', 'LLY'],
  ['COST', 'Costco', 'cost.us', 'COST'],
  ['PLTR', 'Palantir', 'pltr.us', 'PLTR'],
  ['COIN', 'Coinbase', 'coin.us', 'COIN'],
  ['UBER', 'Uber', 'uber.us', 'UBER'],
  ['CAT', 'Caterpillar', 'cat.us', 'CAT'],
  ['BA', 'Boeing', 'ba.us', 'BA'],
];

/**
 * `td` ist das Kuerzel bei Twelve Data, `tdMic` die Boersenkennung dort.
 * Ohne diese Angabe waere "SAP" mehrdeutig — es gibt den Titel an mehreren
 * Handelsplaetzen mit unterschiedlichen Kursen.
 */
const build = (rows, venue, market, currency, tdMic) =>
  rows.map(([symbol, name, stooq, td]) => ({
    symbol, name, stooq, td, tdMic, venue, market, currency,
  }));

const UNIVERSE = [
  ...build(DE, 'XETRA', 'DE', 'EUR', 'XETR'),
  ...build(US, 'US', 'US', 'USD', null),
];

/** Leitindizes fuer die Marktlage — gleiche Abfrage, andere Rolle. */
const BENCHMARKS = [
  { symbol: '^GDAXI', name: 'DAX', market: 'DE', venue: 'XETRA', td: 'DAX' },
  { symbol: '^GSPC', name: 'S&P 500', market: 'US', venue: 'US', td: 'SPX' },
  { symbol: '^IXIC', name: 'Nasdaq Composite', market: 'US', venue: 'US', td: 'IXIC' },
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
