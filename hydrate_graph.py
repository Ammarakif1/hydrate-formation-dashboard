import os

os.environ['NO_MAC_EXTENSIONS'] = '1'

from app import readData, detectHydrateFormation
import pandas as pd
import matplotlib.pyplot as plt

# Step 1: Read the data using readData from app.py
file_name = "Ruthless_745H-10_01-10_08.csv"
dataPoints = readData(file_name)

# Step 2: Detect hydrate formation and normalization using detectHydrateFormation from app.py
hydrate_times, normal_times = detectHydrateFormation(dataPoints)

# Step 3: Convert dataPoints into a pandas DataFrame for plotting
data_dict = {
    'Time': [dp.time for dp in dataPoints],
    'InstantaneousVolume': [dp.instantaneousVolume for dp in dataPoints],
    'SetpointVolume': [dp.setpointVolume for dp in dataPoints],
    'ValvePercentOpen': [dp.valvePercentOpen for dp in dataPoints],
    'HydrateChance': [dp.hydrateChance for dp in dataPoints]
}
data = pd.DataFrame(data_dict)

# Convert 'Time' to datetime with specified format
data['Time'] = pd.to_datetime(data['Time'], format='%m/%d/%Y %I:%M:%S %p')

# Step 4: Plot the data
fig, ax1 = plt.subplots(figsize=(12, 6))

# Plot Instantaneous Volume and Setpoint Volume on primary y-axis
ax1.plot(data['Time'], data['InstantaneousVolume'], label="Instantaneous Volume", color="blue")
ax1.plot(data['Time'], data['SetpointVolume'], label="Setpoint Volume", color="green")
ax1.set_xlabel("Time")
ax1.set_ylabel("Volume")
ax1.grid()

# Plot Valve Percent Open and Hydrate Chance on secondary y-axis
ax2 = ax1.twinx()
ax2.plot(data['Time'], data['ValvePercentOpen'], label="Valve Percent Open", color="purple", alpha=0.7)
ax2.plot(data['Time'], data['HydrateChance'], label="Hydrate Chance", color="red", linewidth=2)
ax2.set_ylabel("Valve Percent Open (%) / Hydrate Chance (%)")

# Add vertical lines when hydrate chance goes upward over 80% and resets below 40%
is_hydrating = False  # Track whether the system is in the "hydrating" state
hydrating_label_added = False  # To ensure the label is added only once
reset_label_added = False  # To ensure the label is added only once

for i in range(1, len(data['HydrateChance'])):
    previous_chance = data['HydrateChance'][i - 1]
    current_chance = data['HydrateChance'][i]

    # Enter hydrating state when crossing upward over 70%
    if not is_hydrating and current_chance >= 50:
        is_hydrating = True
        print(f"Hydrate chance is {current_chance:.2f}% at {i:.2f}")
        print(f"Lower the valve from {data['ValvePercentOpen'][i]:.2f}% to {max(data['ValvePercentOpen'][i] - 20, 0):.2f} and the estimate volume should be: {(data['InstantaneousVolume'][i] * .8)}%")

        if not hydrating_label_added:
            ax1.axvline(x=data['Time'][i], color='orange', linestyle='--', alpha=0.7, label="Hydrate Chance >= 50")
            hydrating_label_added = True
        else:
            ax1.axvline(x=data['Time'][i], color='orange', linestyle='--', alpha=0.7)

    # Exit hydrating state when dropping below 20%
    if is_hydrating and current_chance < 20:
        is_hydrating = False
        if not reset_label_added:
            ax1.axvline(x=data['Time'][i], color='gray', linestyle='--', alpha=0.5, label="Hydrate Chance < 20")
            reset_label_added = True
        else:
            ax1.axvline(x=data['Time'][i], color='gray', linestyle='--', alpha=0.5)

# Combine legends from both axes
lines_1, labels_1 = ax1.get_legend_handles_labels()
lines_2, labels_2 = ax2.get_legend_handles_labels()
ax1.legend(lines_1 + lines_2, labels_1 + labels_2, loc='upper left')

# Customize and show the plot
plt.title("Hydrate Formation Detection with Hydrate Chance Over Time")
plt.xticks(rotation=45)
plt.tight_layout()
plt.show()
