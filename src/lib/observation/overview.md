
The next philosophical (and technical) step is to generate these plans automatically from actual data. Right now, orders are manually placed in the commune. In a real system, these would cascade out from ValueFlows Planning. When a VF Process is planned, it should automatically generate the implied structural debts (replacement, reserve, welfare) as communal 

Order
s in the simulator.


This would involve:

Reading a VF Recipe (e.g. "Build Factory").
Passing it to a new Simulator/Scenario object that wraps the 

Commune
.
Auto-generating the primary 

Order
 (the factory).
Auto-generating the cascading secondary Orders (replacement for wear-and-tear, administration overhead, etc.) based on configured sociological ratios.
Returning the 

DayReport
 evaluating if the commune can actually survive the plan.



 ----


 ok this makes sense, but im also left wondering if then orders should come with their availability (when something can occur) and deadlines (when it must occur) that way we dont artifically allocate credits to a project thats not even *available* and we can save those credits for other things
