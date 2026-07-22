use std::{
    collections::BTreeMap,
    env,
    fs::OpenOptions,
    io::{self, BufRead, BufReader, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

use serde_json::json;
use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortType, StopBits};
use tan_studio_service::virtual_nano::{
    VirtualNanoScenario, VirtualNanoTranscript, VirtualNanoTransport, VirtualNanoVerification,
};

const USB_TO_BACKEND: u8 = 1;
const BACKEND_TO_USB: u8 = 2;
const MAX_TUNNEL_PAYLOAD_BYTES: usize = 8_192;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = env::args().skip(1);
    let mode = arguments.next().ok_or("mode is required: bridge or cdc")?;
    let options = parse_options(arguments)?;
    let duration = Duration::from_secs(parse_u64(&options, "duration-seconds")?);
    if duration < Duration::from_secs(1) || duration > Duration::from_secs(8 * 60 * 60) {
        return Err("duration-seconds must be between 1 and 28800".into());
    }
    let transcript_path = absolute_path(&options, "transcript")?;
    let (mut nano, transcript) = VirtualNanoTransport::new(VirtualNanoScenario::smoke())?;

    let run_result = match mode.as_str() {
        "bridge" => run_bridge(&options, duration, &mut nano),
        "cdc" => run_cdc(&options, duration, &mut nano),
        _ => return Err("unknown mode; expected bridge or cdc".into()),
    };
    write_transcript(&transcript_path, &transcript)?;
    let verification = match run_result {
        Ok(verification) => verification,
        Err(error) => {
            eprintln!(
                "{}",
                serde_json::to_string(&json!({
                    "schemaVersion": 1,
                    "mode": mode,
                    "transcriptPath": transcript_path,
                    "verification": nano.verification(),
                    "error": "transport_failed",
                }))?
            );
            return Err(error);
        }
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "schemaVersion": 1,
            "mode": mode,
            "transcriptPath": transcript_path,
            "verification": verification,
        }))?
    );
    if verification.smoke_complete {
        Ok(())
    } else {
        Err("virtual Nano smoke session did not complete".into())
    }
}

fn run_bridge(
    options: &BTreeMap<String, String>,
    duration: Duration,
    nano: &mut VirtualNanoTransport,
) -> Result<VirtualNanoVerification, Box<dyn std::error::Error>> {
    let host = required(options, "host")?;
    let port = parse_u16(options, "port")?;
    let bridge_id = required(options, "bridge-id")?;
    if bridge_id.len() != 26
        || !bridge_id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || (b'2'..=b'7').contains(&byte))
    {
        return Err("bridge-id must be a 26-character lower-case base32 value".into());
    }
    let claim_token = env::var("TAN_STUDIO_BRIDGE_CLAIM_TOKEN")
        .map_err(|_| "TAN_STUDIO_BRIDGE_CLAIM_TOKEN is required")?;
    if claim_token.len() != 64 || !claim_token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("bridge claim token is invalid".into());
    }
    let address = (host.as_str(), port)
        .to_socket_addrs()?
        .next()
        .ok_or("bridge address did not resolve")?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(5))?;
    stream.set_nodelay(true)?;
    stream.set_read_timeout(Some(Duration::from_millis(25)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    let mut hello = serde_json::to_vec(&json!({
        "schemaVersion": 1,
        "bridgeId": bridge_id,
        "firmwareVersion": "simulator-1",
        "buildId": "mac-virtual-nano",
        "claimToken": claim_token,
    }))?;
    hello.push(b'\n');
    stream.write_all(&hello)?;
    stream.flush()?;
    let mut response = String::new();
    BufReader::new(stream.try_clone()?).read_line(&mut response)?;
    let response: serde_json::Value = serde_json::from_str(response.trim_end())?;
    if response.get("accepted").and_then(|value| value.as_bool()) != Some(true) {
        return Err("bridge handshake was rejected".into());
    }

    let started = Instant::now();
    let mut network_buffer = Vec::with_capacity(MAX_TUNNEL_PAYLOAD_BYTES + 3);
    let mut io_buffer = [0u8; MAX_TUNNEL_PAYLOAD_BYTES];
    while started.elapsed() < duration {
        pump_nano_to_bridge(nano, &mut stream, &mut io_buffer)?;
        match stream.read(&mut io_buffer) {
            Ok(0) => return Err("bridge closed the tunnel".into()),
            Ok(length) => {
                network_buffer.extend_from_slice(&io_buffer[..length]);
                decode_bridge_frames(&mut network_buffer, nano)?;
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut
                        | io::ErrorKind::WouldBlock
                        | io::ErrorKind::Interrupted
                ) => {}
            Err(error) => return Err(error.into()),
        }
        thread::sleep(Duration::from_millis(1));
    }
    Ok(nano.verification())
}

fn run_cdc(
    options: &BTreeMap<String, String>,
    duration: Duration,
    nano: &mut VirtualNanoTransport,
) -> Result<VirtualNanoVerification, Box<dyn std::error::Error>> {
    let port_path = required(options, "port")?;
    if !port_path.starts_with("/dev/cu.usbmodem") || port_path.len() > 1_024 {
        return Err("CDC port must be an explicit macOS /dev/cu.usbmodem path".into());
    }
    // A watchdog reset or software reboot makes macOS remove and recreate the
    // same CDC node. Waiting here distinguishes that enumeration gap from an
    // unsafe attempt to open an arbitrary serial device.
    let mut port = open_tan_cdc(port_path, Duration::from_secs(15))?;

    let started = Instant::now();
    let mut bytes = [0u8; MAX_TUNNEL_PAYLOAD_BYTES];
    while started.elapsed() < duration {
        loop {
            match nano.read(&mut bytes) {
                Ok(0) => break,
                Ok(length) => {
                    port.write_all(&bytes[..length])?;
                    port.flush()?;
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::TimedOut
                            | io::ErrorKind::WouldBlock
                            | io::ErrorKind::Interrupted
                    ) =>
                {
                    break
                }
                Err(error) => return Err(error.into()),
            }
        }
        match port.read(&mut bytes) {
            Ok(0) => {}
            Ok(length) => nano.write_all(&bytes[..length])?,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut
                        | io::ErrorKind::WouldBlock
                        | io::ErrorKind::Interrupted
                ) => {}
            Err(error) => return Err(error.into()),
        }
        thread::sleep(Duration::from_millis(1));
    }
    Ok(nano.verification())
}

fn open_tan_cdc(
    port_path: &str,
    timeout: Duration,
) -> Result<Box<dyn SerialPort>, Box<dyn std::error::Error>> {
    let deadline = Instant::now() + timeout;
    let mut observed_tan_device = false;
    while Instant::now() < deadline {
        if let Ok(ports) = serialport::available_ports() {
            if let Some(descriptor) = ports.into_iter().find(|port| port.port_name == port_path) {
                let SerialPortType::UsbPort(usb) = descriptor.port_type else {
                    return Err("CDC port is not a USB device".into());
                };
                if !usb
                    .product
                    .as_deref()
                    .is_some_and(|product| product.starts_with("Tan "))
                {
                    return Err("CDC product is not a Tan device".into());
                }
                observed_tan_device = true;
                if let Ok(mut port) = serialport::new(port_path, 115_200)
                    .timeout(Duration::from_millis(25))
                    .data_bits(DataBits::Eight)
                    .flow_control(FlowControl::None)
                    .parity(Parity::None)
                    .stop_bits(StopBits::One)
                    .dtr_on_open(true)
                    .open()
                {
                    if port.write_data_terminal_ready(true).is_ok() {
                        return Ok(port);
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
    if observed_tan_device {
        Err("Tan CDC device was observed but could not be opened before timeout".into())
    } else {
        Err("Tan CDC device did not enumerate before timeout".into())
    }
}

fn pump_nano_to_bridge(
    nano: &mut VirtualNanoTransport,
    stream: &mut TcpStream,
    buffer: &mut [u8],
) -> io::Result<()> {
    loop {
        match nano.read(buffer) {
            Ok(0) => return Ok(()),
            Ok(length) => {
                let encoded = u16::try_from(length)
                    .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "frame too large"))?;
                stream.write_all(&[USB_TO_BACKEND])?;
                stream.write_all(&encoded.to_be_bytes())?;
                stream.write_all(&buffer[..length])?;
                stream.flush()?;
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut
                        | io::ErrorKind::WouldBlock
                        | io::ErrorKind::Interrupted
                ) =>
            {
                return Ok(())
            }
            Err(error) => return Err(error),
        }
    }
}

fn decode_bridge_frames(
    network_buffer: &mut Vec<u8>,
    nano: &mut VirtualNanoTransport,
) -> io::Result<()> {
    while network_buffer.len() >= 3 {
        let kind = network_buffer[0];
        let length = u16::from_be_bytes([network_buffer[1], network_buffer[2]]) as usize;
        if kind != BACKEND_TO_USB || length == 0 || length > MAX_TUNNEL_PAYLOAD_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid backend tunnel frame",
            ));
        }
        if network_buffer.len() < length + 3 {
            break;
        }
        nano.write_all(&network_buffer[3..3 + length])?;
        network_buffer.drain(..3 + length);
    }
    Ok(())
}

fn parse_options(
    mut arguments: impl Iterator<Item = String>,
) -> Result<BTreeMap<String, String>, Box<dyn std::error::Error>> {
    let mut options = BTreeMap::new();
    while let Some(name) = arguments.next() {
        let key = name
            .strip_prefix("--")
            .filter(|key| !key.is_empty())
            .ok_or("options must use --name value syntax")?;
        let value = arguments.next().ok_or("option value is missing")?;
        if value.starts_with("--") || options.insert(key.to_owned(), value).is_some() {
            return Err("invalid or duplicate option".into());
        }
    }
    Ok(options)
}

fn required<'a>(
    options: &'a BTreeMap<String, String>,
    key: &str,
) -> Result<&'a String, Box<dyn std::error::Error>> {
    options
        .get(key)
        .filter(|value| !value.is_empty() && value.len() <= 4_096 && !value.contains('\0'))
        .ok_or_else(|| format!("--{key} is required").into())
}

fn parse_u64(
    options: &BTreeMap<String, String>,
    key: &str,
) -> Result<u64, Box<dyn std::error::Error>> {
    Ok(required(options, key)?.parse()?)
}

fn parse_u16(
    options: &BTreeMap<String, String>,
    key: &str,
) -> Result<u16, Box<dyn std::error::Error>> {
    let value = required(options, key)?.parse::<u16>()?;
    if value == 0 {
        return Err(format!("--{key} must be non-zero").into());
    }
    Ok(value)
}

fn absolute_path(
    options: &BTreeMap<String, String>,
    key: &str,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let path = PathBuf::from(required(options, key)?);
    if !path.is_absolute() || path.file_name().is_none() {
        return Err(format!("--{key} must be an absolute file path").into());
    }
    Ok(path)
}

fn write_transcript(path: &Path, transcript: &VirtualNanoTranscript) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "transcript parent missing"))?;
    std::fs::create_dir_all(parent)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "transcript filename"))?;
    let temporary = parent.join(format!(".{name}.tmp-{}", std::process::id()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(
        transcript
            .to_json_lines()
            .map_err(io::Error::other)?
            .as_bytes(),
    )?;
    file.sync_all()?;
    std::fs::rename(temporary, path)
}
