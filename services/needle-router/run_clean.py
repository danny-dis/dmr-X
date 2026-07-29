import os
import sys

# Remove Hermes venv from path if present
paths = [p for p in sys.path if 'hermes-agent' not in p and '\\AppData\\Local\\hermes\\' not in p]
while len(sys.path):
    sys.path.pop()
sys.path.extend(paths)

os.environ['PYTHONPATH'] = ''

if __name__ == '__main__':
    # Now run the actual server
    import runpy
    runpy.run_path('server.py', run_name='__main__')
