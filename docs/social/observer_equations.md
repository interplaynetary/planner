# **Scope Committee Observer Equations**

**`Physical Flow Fractions`**

- **`Input Fraction from Social Plan:`**  
  `x = Q_in_social / Q_in_total`
- **`Output Fraction to Social Plan:`**  
  `y = Q_out_social / Q_out_total`  
  _These are physical ratios, measuring real quantities, not prices._

**`Dollar Flows`**

- **`Net Dollar Flow:`**  
  `Net_dollar_flow = (R_market + R_social_dollar + D_received) - (C_market + C_social_dollar + W_dollar + O_dollar + D_sent)`  
  _This must be ≥ 0 for the scope to remain solvent in dollars._

**`Labor Flows`**

- **`Total Hours Worked (Scope):`**  
  `H_total = Σ H_total_i`
- **`Socially Validated Hours (per worker):`**  
  `V_i = y × H_total_i`  
  _The federation only validates their effort in proportion to the output it actually receives._
- **`Total Validated Hours (Scope):`**  
  `V_total = Σ V_i`

**`Worker Claim Capacity`**

- **`Contribution Claim:`**  
  `contribution_claim_i = (y × H_total_i) × (available_claimable_pool / total_social_svc)`
- **`Solidarity Supplement:`**  
  `solidarity_supplement_i = (1 - ccf_i) × (social_welfare_fund / Σ(1 - ccf_i))`
- **`Total Claim Capacity:`**  
  `total_claim_capacity_i = contribution_claim_i + solidarity_supplement_i`  
  _This formula naturally links the compensation directly to the scope's progress in transitioning to social production._

**`The Compensation Equations`**

- **`Dollar Wage (market output):`**  
  `dollar_wage_i ≈ (1-y) × H_total_i × (market_value_per_hour)`
- **`Claim Capacity (social output):`**  
  `claim_capacity_i ≈ y × H_total_i × (social_value_per_hour)`  
  _Where social_value_per_hour is reflected in the ratio: available_claimable_pool / total_social_svc._

**`Scope-Level Aggregates`**

- **`Average Dollar Wage:`**  
  `average_dollar_wage_per_hour = W_dollar_total / H_total`
- **`Average Claim Rate:`**  
  `average_claim_per_validated_hour = available_claimable_pool / total_social_svc`

**`The substitution ratio`**

- **`substitution ratio (Current):`**  
  `fairness_ratio = [average_claim_per_validated_hour × y] / [average_dollar_wage_per_hour × (1-y)]`  
  _If ratio < 1, social portion pays worse (resistance to transition). If > 1, social pays better. If ≈ 1, compensation is balanced._

**`Transition Constraints`**

- **`Future Dollar Balance:`**  
  `R_market_next + R_social_dollar_next + D_received_next ≥ C_market_next + C_social_dollar_next + W_dollar_next + O_dollar_next + D_sent_next`
- **`Future Dollar Wage Requirement:`**  
  `W_dollar_next = (1 - y_next) × (total output value in dollars) × (labor_share_of_output)`  
  _Or, assuming wages are a stable fraction of revenue:_  
  `W_dollar_next = (1 - y_next) × (W_dollar_current / (1 - y_current)) × (H_total_next / H_total_current)`
- **`The Fairness Constraint:`**  
  `fairness_ratio_next ≈ 1`  
  `average_claim_per_validated_hour × y_next ≈ average_dollar_wage_per_hour_next × (1-y_next)`  
  _To accept a transition to y_next, workers must maintain fair compensation._
