import os
import csv
from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime
from werkzeug.utils import secure_filename

os.environ['NO_MAC_EXTENSIONS'] = '1'

UPLOAD_FOLDER = './uploads'  # Folder to save uploaded files
ALLOWED_EXTENSIONS = {'csv'}

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
CORS(app)  # Enable CORS for all routes

# Ensure the uploads directory exists
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

class DataPoint:
    def __init__(self, time, instantaneousVolume, setpointVolume, valvePercentOpen):
        self.time = time
        self.instantaneousVolume = instantaneousVolume
        self.setpointVolume = setpointVolume
        self.valvePercentOpen = valvePercentOpen
        self.hydrateChance = 0  # Initialize hydrate chance
        self.potentialHydrateFix = None  # Initialize potential hydrate fix

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def readData(fileName):
    dataPoints = []
    lastSetpoint = -1
    lastValvePercent = -1

    try:
        with open(fileName, 'r') as csvfile:
            reader = csv.reader(csvfile)
            next(reader)  # Skip header
            for parts in reader:
                if len(parts) < 2 or parts[1].strip() == '':
                    continue  # Skip malformed rows or rows missing instantaneous volume

                time = parts[0]
                try:
                    instantaneousVolume = float(parts[1])
                except ValueError:
                    print(f"Error parsing instantaneous volume at time {time}")
                    continue

                setpointVolume = lastSetpoint
                if len(parts) > 2 and parts[2].strip() != '':
                    try:
                        setpointVolume = float(parts[2])
                    except ValueError:
                        print(f"Error parsing setpoint volume at time {time}")

                valvePercentOpen = lastValvePercent
                if len(parts) > 3 and parts[3].strip() != '':
                    try:
                        valvePercentOpen = float(parts[3])
                    except ValueError:
                        print(f"Error parsing valve percent open at time {time}")

                lastSetpoint = setpointVolume
                lastValvePercent = valvePercentOpen
                dataPoints.append(DataPoint(time, instantaneousVolume, setpointVolume, valvePercentOpen))
    except FileNotFoundError as e:
        print(f"Error reading the file: {e}")
    except Exception as e:
        print(f"An error occurred: {e}")

    return dataPoints

# Your existing detectHydrateFormation function (unchanged)
def detectHydrateFormation(dataPoints, time_lag=3):
    TARGET_TOLERANCE = 0.1
    VOLUME_DERIVATIVE_THRESHOLD = -0.05
    VALVE_DERIVATIVE_THRESHOLD = 5
    STALLED_VOLUME_THRESHOLD = 0.01
    SYNC_THRESHOLD = 0.05

    base_increase_rate = 2.5
    significant_increase_rate = 5
    base_decrease_rate = 5

    hydrate_times = []
    normal_times = []

    smoothed_valve_positions = [dp.valvePercentOpen for dp in dataPoints]
    consecutive_decreases = 0

    for i in range(1, len(dataPoints)):
        current = dataPoints[i]
        previous = dataPoints[i - 1]

        if i >= time_lag:
            smoothed_valve_positions[i] = sum(
                dp.valvePercentOpen for dp in dataPoints[i - time_lag:i + 1]
            ) / (time_lag + 1)

        if current.setpointVolume <= 0 or current.valvePercentOpen <= 0:
            current.hydrateChance = previous.hydrateChance
            continue

        volume_derivative = current.instantaneousVolume - previous.instantaneousVolume
        valve_derivative = (
            smoothed_valve_positions[i] - smoothed_valve_positions[i - 1]
            if i > 0
            else 0
        )

        deviation = abs(current.instantaneousVolume - current.setpointVolume)

        chance_increase = 0
        chance_decrease = 0

        if valve_derivative > 0:
            sustained_increase = all(
                dataPoints[j].valvePercentOpen >= dataPoints[j - 1].valvePercentOpen
                for j in range(max(1, i - time_lag), i + 1)
            )
            if sustained_increase:
                chance_increase += valve_derivative * base_increase_rate

        elif valve_derivative < 0:
            chance_decrease += abs(valve_derivative) * base_decrease_rate

        if deviation > current.setpointVolume * TARGET_TOLERANCE:
            if deviation > current.setpointVolume * 2 * TARGET_TOLERANCE or volume_derivative < 2 * VOLUME_DERIVATIVE_THRESHOLD:
                chance_increase += significant_increase_rate * abs(volume_derivative)
            else:
                chance_increase += base_increase_rate * (deviation / current.setpointVolume)

        if abs(valve_derivative) > VALVE_DERIVATIVE_THRESHOLD:
            chance_increase += base_increase_rate * (abs(valve_derivative) / 100)

        if abs(volume_derivative - valve_derivative) < SYNC_THRESHOLD:
            chance_decrease += base_decrease_rate * (5 ** consecutive_decreases)

        if abs(volume_derivative) < STALLED_VOLUME_THRESHOLD and abs(valve_derivative) < STALLED_VOLUME_THRESHOLD:
            chance_decrease = 0

        if chance_increase > 0:
            hydrateChance = min(previous.hydrateChance + chance_increase, 100)
            consecutive_decreases = 0
        elif chance_decrease > 0:
            hydrateChance = max(previous.hydrateChance - chance_decrease, 0)
            consecutive_decreases += 1
        else:
            hydrateChance = previous.hydrateChance

        current.hydrateChance = hydrateChance

        if current.hydrateChance > 50:
            hydrate_times.append(current.time)
        elif previous.hydrateChance > 50 and current.hydrateChance <= 50:
            normal_times.append(current.time)

    if not hydrate_times and not normal_times:
        print("System has been normal throughout.")

    return hydrate_times, normal_times

# Updated function to calculate PotentialHydrateFix with 20% reduction
def calculatePotentialHydrateFix(dataPoints):
    if not dataPoints:
        return dataPoints

    # Calculate the average ValvePercentOpen across all data points
    average_valve_percent_open = sum(dp.valvePercentOpen for dp in dataPoints) / len(dataPoints)

    for dp in dataPoints:
        if dp.hydrateChance >= 80:
            dp.potentialHydrateFix = max(average_valve_percent_open * 0.80, 0)  # Reduce by 20%, not below 0%
        else:
            dp.potentialHydrateFix = None  # Set to None when hydrateChance < 80
    return dataPoints

@app.route('/api/hydrate_data', methods=['POST'])
def get_hydrate_data():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part in the request'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        dataPoints = readData(filepath)
        hydrate_times, normal_times = detectHydrateFormation(dataPoints)

        dataPoints = calculatePotentialHydrateFix(dataPoints)  # Calculate PotentialHydrateFix

        os.remove(filepath)

        data_list = []
        hydrate_events = []  # List to store all hydrate instances

        for dp in dataPoints:
            try:
                time_iso = datetime.strptime(dp.time, '%m/%d/%Y %I:%M:%S %p').isoformat()
            except ValueError:
                time_iso = dp.time
            data_entry = {
                'Time': time_iso,
                'InstantaneousVolume': dp.instantaneousVolume,
                'SetpointVolume': dp.setpointVolume,
                'ValvePercentOpen': dp.valvePercentOpen,
                'HydrateChance': dp.hydrateChance,
                'PotentialHydrateFix': dp.potentialHydrateFix
            }
            data_list.append(data_entry)

            # If HydrateChance is 80% or higher, add to hydrate_events
            if dp.hydrateChance >= 80:
                hydrate_events.append({
                    'Time': time_iso,
                    'HydrateChance': dp.hydrateChance,
                    'PotentialHydrateFix': dp.potentialHydrateFix
                })

        return jsonify({
            'data': data_list,
            'hydrateEvents': hydrate_events
        })
    else:
        return jsonify({'error': 'Invalid file type'}), 400

if __name__ == '__main__':
    app.run(debug=True)
