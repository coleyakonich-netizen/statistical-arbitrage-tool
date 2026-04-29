# Quantitative Statistical Arbitrage Engine

A full-stack, quantitative research terminal designed to identify, test, and visualize statistical arbitrage opportunities across the S&P 400 (Mid-Cap) and S&P 600 (Small-Cap) indices.

## 🧠 System Architecture

The engine operates on a two-phase automated pipeline:

### Phase 1: High-Speed Radar
The engine scrapes live data and isolates equities by their Sub-Industry (e.g., pairing Regional Banks only with Regional Banks) to ensure a true macroeconomic tether. It downloads 1 year of historical data and runs:
* **Engle-Granger Cointegration Tests** to prove a mathematical relationship.
* **Ornstein-Uhlenbeck Process Modeling** to calculate the half-life of the mean-reverting spread.
* **Opportunity Velocity Scoring:** A custom ranking algorithm that weighs the cointegration p-value, the R^2 correlation, and the half-life.

### Phase 2: Dynamic Walk-Forward Optimization
The top candidates from Phase 1 are moved to an out-of-sample testing environment. 
* **Dynamic Window Sizing:** The engine calculates the specific half-life of each pair and dynamically builds custom Train/Test rolling windows (e.g., an 8-cycle train, 2-cycle test).
* Pairs that fail to remain cointegrated across multiple out-of-sample market regimes are removed.

## ⚙️ Tech Stack

**Frontend:**
* React / Next.js (App Router)
* Tailwind CSS
* Recharts
* WebSockets (For real-time scanning feedback)

**Backend:**
* Python / FastAPI 
* Pandas & NumPy (Data manipulation)
* Statsmodels (Cointegration and OLS Regression math)
* yfinance (Historical market data routing)

## 🚀 How to Run Locally

To run this engine on your local machine, you will need two terminal windows open.

**1. Start the Python Backend**
Navigate to the `backend` folder, install the required math and data libraries, and boot the API.
```bash
cd backend
pip install -r requirements.txt
uvicorn api_server:app --reload --port 8000
