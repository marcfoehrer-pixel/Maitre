'use strict';

/**
 * Indexmitglieder: DAX 40, Dow Jones 30, Nasdaq-100.
 *
 * Indizes werden quartalsweise angepasst — diese Liste ist von Hand gepflegt.
 * Ein Titel, der nicht mehr gehandelt wird, bricht nichts: er wird beim Abruf
 * uebersprungen und im Bericht als fehlend ausgewiesen.
 */

const DAX = [
  ['ADS', 'Adidas'], ['AIR', 'Airbus'], ['ALV', 'Allianz'], ['BAS', 'BASF'],
  ['BAYN', 'Bayer'], ['BEI', 'Beiersdorf'], ['BMW', 'BMW'], ['BNR', 'Brenntag'],
  ['CBK', 'Commerzbank'], ['CON', 'Continental'], ['DTG', 'Daimler Truck'],
  ['DBK', 'Deutsche Bank'], ['DB1', 'Deutsche Börse'], ['DHL', 'DHL Group'],
  ['DTE', 'Deutsche Telekom'], ['EOAN', 'E.ON'], ['FRE', 'Fresenius'],
  ['FME', 'Fresenius Medical Care'], ['G24', 'Scout24'], ['HNR1', 'Hannover Rück'],
  ['HEI', 'Heidelberg Materials'], ['HEN3', 'Henkel Vz.'], ['IFX', 'Infineon'],
  ['MBG', 'Mercedes-Benz'], ['MRK', 'Merck KGaA'], ['MTX', 'MTU Aero Engines'],
  ['MUV2', 'Munich Re'], ['P911', 'Porsche AG'], ['PAH3', 'Porsche SE'],
  ['QIA', 'Qiagen'], ['RHM', 'Rheinmetall'], ['RWE', 'RWE'], ['SAP', 'SAP'],
  ['SRT3', 'Sartorius Vz.'], ['SIE', 'Siemens'], ['ENR', 'Siemens Energy'],
  ['SHL', 'Siemens Healthineers'], ['SY1', 'Symrise'], ['VOW3', 'Volkswagen Vz.'],
  ['VNA', 'Vonovia'], ['ZAL', 'Zalando'],
];

const DOW = [
  ['AAPL', 'Apple'], ['AMGN', 'Amgen'], ['AMZN', 'Amazon'], ['AXP', 'American Express'],
  ['BA', 'Boeing'], ['CAT', 'Caterpillar'], ['CRM', 'Salesforce'], ['CSCO', 'Cisco'],
  ['CVX', 'Chevron'], ['DIS', 'Walt Disney'], ['GS', 'Goldman Sachs'], ['HD', 'Home Depot'],
  ['HON', 'Honeywell'], ['IBM', 'IBM'], ['JNJ', 'Johnson & Johnson'], ['JPM', 'JPMorgan'],
  ['KO', 'Coca-Cola'], ['MCD', "McDonald's"], ['MMM', '3M'], ['MRK', 'Merck & Co.'],
  ['MSFT', 'Microsoft'], ['NKE', 'Nike'], ['NVDA', 'Nvidia'], ['PG', 'Procter & Gamble'],
  ['SHW', 'Sherwin-Williams'], ['TRV', 'Travelers'], ['UNH', 'UnitedHealth'], ['V', 'Visa'],
  ['VZ', 'Verizon'], ['WMT', 'Walmart'],
];

const NASDAQ100 = [
  ['AAPL', 'Apple'], ['ABNB', 'Airbnb'], ['ADBE', 'Adobe'], ['ADI', 'Analog Devices'],
  ['ADP', 'ADP'], ['ADSK', 'Autodesk'], ['AEP', 'American Electric Power'],
  ['AMAT', 'Applied Materials'], ['AMD', 'AMD'], ['AMGN', 'Amgen'], ['AMZN', 'Amazon'],
  ['APP', 'AppLovin'], ['ARM', 'Arm Holdings'], ['ASML', 'ASML'], ['AVGO', 'Broadcom'],
  ['AXON', 'Axon Enterprise'], ['AZN', 'AstraZeneca'], ['BIIB', 'Biogen'],
  ['BKNG', 'Booking Holdings'], ['BKR', 'Baker Hughes'], ['CCEP', 'Coca-Cola Europacific'],
  ['CDNS', 'Cadence Design'], ['CDW', 'CDW'], ['CEG', 'Constellation Energy'],
  ['CHTR', 'Charter Communications'], ['CMCSA', 'Comcast'], ['COST', 'Costco'],
  ['CPRT', 'Copart'], ['CRWD', 'CrowdStrike'], ['CSCO', 'Cisco'], ['CSGP', 'CoStar'],
  ['CSX', 'CSX'], ['CTAS', 'Cintas'], ['CTSH', 'Cognizant'], ['DASH', 'DoorDash'],
  ['DDOG', 'Datadog'], ['DXCM', 'Dexcom'], ['EA', 'Electronic Arts'], ['EXC', 'Exelon'],
  ['FANG', 'Diamondback Energy'], ['FAST', 'Fastenal'], ['FTNT', 'Fortinet'],
  ['GEHC', 'GE HealthCare'], ['GFS', 'GlobalFoundries'], ['GILD', 'Gilead Sciences'],
  ['GOOG', 'Alphabet C'], ['GOOGL', 'Alphabet A'], ['HON', 'Honeywell'],
  ['IDXX', 'Idexx Laboratories'], ['INTC', 'Intel'], ['INTU', 'Intuit'],
  ['ISRG', 'Intuitive Surgical'], ['KDP', 'Keurig Dr Pepper'], ['KHC', 'Kraft Heinz'],
  ['KLAC', 'KLA'], ['LIN', 'Linde'], ['LRCX', 'Lam Research'], ['LULU', 'Lululemon'],
  ['MAR', 'Marriott'], ['MCHP', 'Microchip Technology'], ['MDLZ', 'Mondelez'],
  ['MELI', 'MercadoLibre'], ['META', 'Meta Platforms'], ['MNST', 'Monster Beverage'],
  ['MRVL', 'Marvell Technology'], ['MSFT', 'Microsoft'], ['MSTR', 'Strategy'],
  ['MU', 'Micron Technology'], ['NFLX', 'Netflix'], ['NVDA', 'Nvidia'],
  ['NXPI', 'NXP Semiconductors'], ['ODFL', 'Old Dominion Freight'], ['ON', 'ON Semiconductor'],
  ['ORLY', "O'Reilly Automotive"], ['PANW', 'Palo Alto Networks'], ['PAYX', 'Paychex'],
  ['PCAR', 'Paccar'], ['PDD', 'PDD Holdings'], ['PEP', 'PepsiCo'], ['PLTR', 'Palantir'],
  ['PYPL', 'PayPal'], ['QCOM', 'Qualcomm'], ['REGN', 'Regeneron'], ['ROP', 'Roper Technologies'],
  ['ROST', 'Ross Stores'], ['SBUX', 'Starbucks'], ['SHOP', 'Shopify'], ['SNPS', 'Synopsys'],
  ['TEAM', 'Atlassian'], ['TMUS', 'T-Mobile US'], ['TRI', 'Thomson Reuters'],
  ['TSLA', 'Tesla'], ['TTD', 'The Trade Desk'], ['TTWO', 'Take-Two Interactive'],
  ['TXN', 'Texas Instruments'], ['VRSK', 'Verisk'], ['VRTX', 'Vertex Pharmaceuticals'],
  ['WBD', 'Warner Bros. Discovery'], ['WDAY', 'Workday'], ['XEL', 'Xcel Energy'],
  ['ZS', 'Zscaler'],
];

const INDIZES = ['DAX', 'Nasdaq-100', 'Dow Jones'];

/**
 * Ein Titel je Kuerzel; ein Wert in mehreren Indizes (etwa Apple in Dow und
 * Nasdaq) wird nur einmal abgerufen und traegt alle Zugehoerigkeiten.
 * `td`/`tdMic` sind Kuerzel und Boerse bei Twelve Data — ohne Boerse waere
 * "SAP" mehrdeutig.
 */
function aufbauen() {
  const map = new Map();
  const add = (rows, index, deutsch) => {
    for (const [kurz, name] of rows) {
      const symbol = deutsch ? `${kurz}.DE` : kurz;
      if (!map.has(symbol)) {
        map.set(symbol, {
          symbol, name, indizes: [],
          waehrung: deutsch ? 'EUR' : 'USD',
          td: kurz, tdMic: deutsch ? 'XETR' : null,
        });
      }
      map.get(symbol).indizes.push(index);
    }
  };
  add(DAX, 'DAX', true);
  add(NASDAQ100, 'Nasdaq-100', false);
  add(DOW, 'Dow Jones', false);
  return [...map.values()];
}

module.exports = { UNIVERSUM: aufbauen(), INDIZES };
