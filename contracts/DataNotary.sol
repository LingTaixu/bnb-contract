// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title DataNotary
/// @notice 极简链上存证合约：将不超过 64 字节的数据（如 IPv4/IPv6 文本）写入事件日志。
/// @dev 合约无状态、无所有权，任何地址均可调用。数据仅存于事件日志，可通过 txHash 从 RPC 回查。
contract DataNotary {
    /// @notice 单次存证允许的最大字节数，覆盖 IPv4/IPv6 文本及带端口形式。
    uint256 public constant MAX_DATA_LENGTH = 64;

    /// @notice 每次成功存证时发出，包含链上时间戳与原始字节数据。
    /// @param timestamp 存证所在区块的时间戳，由链上提供，调用方无法伪造。
    /// @param data 存证的原始字节数据。
    event Stored(uint256 indexed timestamp, bytes data);

    /// @notice 存证一段字节数据。
    /// @param data 待存证的字节数据，长度须在 (0, 64] 之间。
    function store(bytes calldata data) external {
        require(data.length > 0, "DataNotary: empty data");
        require(data.length <= MAX_DATA_LENGTH, "DataNotary: data too large");

        emit Stored(block.timestamp, data);
    }
}
